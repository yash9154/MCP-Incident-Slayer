/**
 * Database Helper — Shared SQLite wrapper using sql.js (WASM)
 *
 * Provides a persistent, file-backed SQLite database with
 * automatic initialization and periodic auto-save.
 * Used by both logs-db and remediation-executor tools.
 *
 * sql.js compiles SQLite to WebAssembly — no native C++ build tools needed.
 */

'use strict';

const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');

// ── Configuration ──────────────────────────────────────────
const DB_DIR = path.resolve(process.env.DB_PATH ? path.dirname(process.env.DB_PATH) : './data');
const DB_FILE = process.env.DB_PATH || path.join(DB_DIR, 'incident-slayer.db');
const AUTOSAVE_INTERVAL_MS = 5000; // Save to disk every 5 seconds

let db = null;
let SQL = null;
let saveTimer = null;
let initPromise = null;

/**
 * Initialize the sql.js library and open/create the database file.
 * Safe to call multiple times — returns the same instance.
 * @returns {Promise<object>} The sql.js database instance
 */
async function getDatabase() {
    if (db) return db;
    if (initPromise) return initPromise;

    initPromise = (async () => {
        try {
            // Ensure data directory exists
            if (!fs.existsSync(DB_DIR)) {
                fs.mkdirSync(DB_DIR, { recursive: true });
                console.log(`[database] Created data directory: ${DB_DIR}`);
            }

            // Initialize sql.js WASM engine
            SQL = await initSqlJs();

            // Load existing database file or create new one
            if (fs.existsSync(DB_FILE)) {
                const fileBuffer = fs.readFileSync(DB_FILE);
                db = new SQL.Database(fileBuffer);
                console.log(`[database] Loaded existing database from ${DB_FILE}`);
            } else {
                db = new SQL.Database();
                console.log(`[database] Created new database at ${DB_FILE}`);
            }

            // Enable WAL journal mode for performance
            db.run('PRAGMA journal_mode = WAL');

            // Start autosave timer
            saveTimer = setInterval(() => saveToDisk(), AUTOSAVE_INTERVAL_MS);

            return db;
        } catch (error) {
            console.error('[database] Failed to initialize:', error.message);
            initPromise = null;
            throw error;
        }
    })();

    return initPromise;
}

/**
 * Persist the in-memory database to disk.
 * Called automatically on an interval and on shutdown.
 */
function saveToDisk() {
    if (!db) return;
    try {
        const data = db.export();
        const buffer = Buffer.from(data);
        fs.writeFileSync(DB_FILE, buffer);
    } catch (error) {
        console.error('[database] Failed to save to disk:', error.message);
    }
}

/**
 * Run a SQL statement that doesn't return data (INSERT, UPDATE, DELETE, CREATE).
 * @param {string} sql - SQL statement
 * @param {object} params - Named parameters (e.g., { $id: '123', $name: 'foo' })
 */
function run(sql, params = {}) {
    if (!db) throw new Error('Database not initialized. Call getDatabase() first.');
    db.run(sql, params);
}

/**
 * Execute raw SQL (for DDL statements like CREATE TABLE).
 * @param {string} sql - SQL statements to execute
 */
function exec(sql) {
    if (!db) throw new Error('Database not initialized. Call getDatabase() first.');
    db.exec(sql);
}

/**
 * Query rows from the database. Returns an array of plain objects.
 * @param {string} sql - SELECT statement
 * @param {object} params - Named parameters
 * @returns {Array<object>} Array of row objects
 */
function queryAll(sql, params = {}) {
    if (!db) throw new Error('Database not initialized. Call getDatabase() first.');

    const stmt = db.prepare(sql);
    stmt.bind(params);

    const rows = [];
    while (stmt.step()) {
        rows.push(stmt.getAsObject());
    }
    stmt.free();
    return rows;
}

/**
 * Query a single row from the database. Returns a plain object or null.
 * @param {string} sql - SELECT statement
 * @param {object} params - Named parameters
 * @returns {object|null}
 */
function queryOne(sql, params = {}) {
    const rows = queryAll(sql, params);
    return rows.length > 0 ? rows[0] : null;
}

/**
 * Gracefully close the database — save to disk and clean up.
 */
function close() {
    if (saveTimer) {
        clearInterval(saveTimer);
        saveTimer = null;
    }
    if (db) {
        saveToDisk();
        db.close();
        db = null;
        initPromise = null;
        console.log('[database] Closed and saved.');
    }
}

/**
 * Reset the database for testing — close and delete the file.
 */
function resetForTesting() {
    close();
    if (fs.existsSync(DB_FILE)) {
        fs.unlinkSync(DB_FILE);
    }
}

module.exports = {
    getDatabase,
    saveToDisk,
    run,
    exec,
    queryAll,
    queryOne,
    close,
    resetForTesting,
    getDbPath: () => DB_FILE,
};
