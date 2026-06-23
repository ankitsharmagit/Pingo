use rusqlite::{params, Connection, Result};
use serde::{Deserialize, Serialize};
use std::path::Path;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Rule {
    pub id: String,
    pub name: String,
    pub category: String,
    pub priority: String, // "high" | "medium" | "low"
    pub enabled: bool,
    pub patterns: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agents: Option<Vec<String>>, // if set, only applies to these agents
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EventLog {
    pub id: String,
    pub timestamp: String,
    pub agent: String,
    pub event_type: String, // "permission" | "success" | "error" | "authentication" | "ratelimit" | "input"
    pub message: String,
    pub priority: String,
}

pub fn init_db(db_path: &Path) -> Result<Connection> {
    let conn = Connection::open(db_path)?;

    // Create rules table
    conn.execute(
        "CREATE TABLE IF NOT EXISTS rules (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            category TEXT NOT NULL,
            priority TEXT NOT NULL,
            enabled INTEGER NOT NULL,
            patterns TEXT NOT NULL
        )",
        [],
    )?;

    // Migration: add agents column if missing (v2 schema)
    let has_agents: bool = conn
        .prepare("PRAGMA table_info(rules)")
        .and_then(|mut stmt| {
            let cols: Vec<String> = stmt
                .query_map([], |row| row.get::<_, String>(1))
                .unwrap()
                .filter_map(|r| r.ok())
                .collect();
            Ok(cols.contains(&"agents".to_string()))
        })
        .unwrap_or(false);
    if !has_agents {
        conn.execute("ALTER TABLE rules ADD COLUMN agents TEXT DEFAULT NULL", [])?;
    }

    // Create events table
    conn.execute(
        "CREATE TABLE IF NOT EXISTS events (
            id TEXT PRIMARY KEY,
            timestamp TEXT NOT NULL,
            agent TEXT NOT NULL,
            event_type TEXT NOT NULL,
            message TEXT NOT NULL,
            priority TEXT NOT NULL
        )",
        [],
    )?;

    // Create preferences table
    conn.execute(
        "CREATE TABLE IF NOT EXISTS preferences (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )",
        [],
    )?;

    seed_default_rules(&conn)?;

    Ok(conn)
}

fn seed_default_rules(conn: &Connection) -> Result<()> {
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM rules",
        [],
        |row| row.get(0),
    )?;

    if count > 0 {
        return Ok(());
    }

    let default_rules = vec![
        Rule {
            id: Uuid::new_v4().to_string(),
            name: "Permission Required".to_string(),
            category: "permission".to_string(),
            priority: "high".to_string(),
            enabled: true,
            patterns: vec![
                "approve".to_string(),
                "allow".to_string(),
                "continue?".to_string(),
                "permission required".to_string(),
                "confirm action".to_string(),
                "press enter to continue".to_string(),
                "waiting for approval".to_string(),
            ],
            agents: None,
        },
        Rule {
            id: Uuid::new_v4().to_string(),
            name: "Task Completed".to_string(),
            category: "success".to_string(),
            priority: "medium".to_string(),
            enabled: true,
            patterns: vec![
                "completed".to_string(),
                "finished".to_string(),
                "done".to_string(),
                "successfully generated".to_string(),
                "task complete".to_string(),
                "all changes applied".to_string(),
            ],
            agents: None,
        },
        Rule {
            id: Uuid::new_v4().to_string(),
            name: "Authentication Issue".to_string(),
            category: "authentication".to_string(),
            priority: "high".to_string(),
            enabled: true,
            patterns: vec![
                "login required".to_string(),
                "authentication failed".to_string(),
                "token expired".to_string(),
                "invalid api key".to_string(),
                "unauthorized".to_string(),
            ],
            agents: None,
        },
        Rule {
            id: Uuid::new_v4().to_string(),
            name: "Error".to_string(),
            category: "error".to_string(),
            priority: "high".to_string(),
            enabled: true,
            patterns: vec![
                "error".to_string(),
                "fatal".to_string(),
                "crashed".to_string(),
                "failed".to_string(),
                "exception".to_string(),
            ],
            agents: None,
        },
        Rule {
            id: Uuid::new_v4().to_string(),
            name: "Waiting for Input".to_string(),
            category: "input".to_string(),
            priority: "medium".to_string(),
            enabled: true,
            patterns: vec![
                "how can i help".to_string(),
                "what would you like".to_string(),
                "what you need".to_string(),
                "what's next".to_string(),
                "ready to help".to_string(),
                "ask me anything".to_string(),
                "type your".to_string(),
                "select an option".to_string(),
                "choose an".to_string(),
                "enter your".to_string(),
                "proceed?".to_string(),
                "could you clarify".to_string(),
                "are you asking about".to_string(),
                "permission for".to_string(),
                "i need more information".to_string(),
                "please clarify".to_string(),
            ],
            agents: None,
        },
        Rule {
            id: Uuid::new_v4().to_string(),
            name: "Rate Limit".to_string(),
            category: "ratelimit".to_string(),
            priority: "high".to_string(),
            enabled: true,
            patterns: vec![
                "rate limit".to_string(),
                "quota exceeded".to_string(),
                "too many requests".to_string(),
                "429".to_string(),
            ],
            agents: None,
        },
    ];

    for rule in default_rules {
        let patterns_json = serde_json::to_string(&rule.patterns).unwrap_or_else(|_| "[]".to_string());
        let agents_json: Option<String> = None;
        conn.execute(
            "INSERT INTO rules (id, name, category, priority, enabled, patterns, agents) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                rule.id,
                rule.name,
                rule.category,
                rule.priority,
                if rule.enabled { 1 } else { 0 },
                patterns_json,
                agents_json,
            ],
        )?;
    }

    Ok(())
}

pub fn get_all_rules(conn: &Connection) -> Result<Vec<Rule>> {
    let mut stmt = conn.prepare("SELECT id, name, category, priority, enabled, patterns, agents FROM rules")?;
    let rule_iter = stmt.query_map([], |row| {
        let patterns_str: String = row.get(5)?;
        let patterns: Vec<String> = serde_json::from_str(&patterns_str).unwrap_or_default();
        let agents_str: Option<String> = row.get(6).ok().flatten();
        let agents: Option<Vec<String>> = agents_str
            .filter(|s| !s.is_empty())
            .and_then(|s| serde_json::from_str(&s).ok());
        Ok(Rule {
            id: row.get(0)?,
            name: row.get(1)?,
            category: row.get(2)?,
            priority: row.get(3)?,
            enabled: row.get::<_, i32>(4)? != 0,
            patterns,
            agents,
        })
    })?;

    let mut rules = Vec::new();
    for rule in rule_iter {
        rules.push(rule?);
    }
    Ok(rules)
}

pub fn save_rule(conn: &Connection, rule: &Rule) -> Result<()> {
    let patterns_json = serde_json::to_string(&rule.patterns).unwrap_or_else(|_| "[]".to_string());
    let agents_json: Option<String> = rule.agents.as_ref().and_then(|a| {
        if a.is_empty() { None } else { serde_json::to_string(a).ok() }
    });
    conn.execute(
        "INSERT INTO rules (id, name, category, priority, enabled, patterns, agents)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            category = excluded.category,
            priority = excluded.priority,
            enabled = excluded.enabled,
            patterns = excluded.patterns,
            agents = excluded.agents",
        params![
            rule.id,
            rule.name,
            rule.category,
            rule.priority,
            if rule.enabled { 1 } else { 0 },
            patterns_json,
            agents_json,
        ],
    )?;
    Ok(())
}

pub fn toggle_rule(conn: &Connection, id: &str, enabled: bool) -> Result<()> {
    conn.execute(
        "UPDATE rules SET enabled = ?1 WHERE id = ?2",
        params![if enabled { 1 } else { 0 }, id],
    )?;
    Ok(())
}

pub fn delete_rule(conn: &Connection, id: &str) -> Result<()> {
    conn.execute("DELETE FROM rules WHERE id = ?", params![id])?;
    Ok(())
}

pub fn get_all_events(conn: &Connection) -> Result<Vec<EventLog>> {
    let mut stmt = conn.prepare("SELECT id, timestamp, agent, event_type, message, priority FROM events ORDER BY timestamp DESC")?;
    let event_iter = stmt.query_map([], |row| {
        Ok(EventLog {
            id: row.get(0)?,
            timestamp: row.get(1)?,
            agent: row.get(2)?,
            event_type: row.get(3)?,
            message: row.get(4)?,
            priority: row.get(5)?,
        })
    })?;

    let mut events = Vec::new();
    for event in event_iter {
        events.push(event?);
    }
    Ok(events)
}

pub fn add_event(conn: &Connection, event: &EventLog) -> Result<()> {
    conn.execute(
        "INSERT INTO events (id, timestamp, agent, event_type, message, priority) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            event.id,
            event.timestamp,
            event.agent,
            event.event_type,
            event.message,
            event.priority
        ],
    )?;
    Ok(())
}

pub fn clear_all_events(conn: &Connection) -> Result<()> {
    conn.execute("DELETE FROM events", [])?;
    Ok(())
}

pub fn get_preference(conn: &Connection, key: &str) -> Result<Option<String>> {
    let mut stmt = conn.prepare("SELECT value FROM preferences WHERE key = ?")?;
    let mut rows = stmt.query(params![key])?;
    if let Some(row) = rows.next()? {
        let val: String = row.get(0)?;
        Ok(Some(val))
    } else {
        Ok(None)
    }
}

pub fn set_preference(conn: &Connection, key: &str, value: &str) -> Result<()> {
    conn.execute(
        "INSERT INTO preferences (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )?;
    Ok(())
}
