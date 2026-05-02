// src-tauri/src/bin/scrape.rs
// Tiny CLI that reuses the runtime parser and import pipeline so the
// release-time scrape script (scripts/scrape-liquipedia.mjs) and the
// in-app importer share exactly one source of truth. Reads page titles
// from argv (one per arg) OR newline-separated stdin, fetches each via
// the existing rate-limited Liquipedia client, and emits a JSON stream
// on stdout: one record per page, one record per line ("ndjson") so the
// caller can stream-aggregate without buffering a giant array.

use bw_build_overlay_lib::liquipedia::{api, import, parser};
use bw_build_overlay_lib::storage::DEFAULT_USER_AGENT;
use bw_build_overlay_lib::types::{Build, Settings};
use serde::Serialize;
use std::io::{self, BufRead, Write};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ScrapeRecord {
    title: String,
    page_title: String,
    revision_id: Option<i64>,
    revision_timestamp: Option<String>,
    builds: Vec<Build>,
    error: Option<String>,
    /// "ok" when at least one variant was extracted, "no-template-no-fallback"
    /// when the page existed but had nothing parseable, or "fetch-error" when
    /// the API call failed (with `error` populated).
    outcome: &'static str,
}

fn settings_from_env() -> Settings {
    let mut s = Settings::default();
    if let Ok(ua) = std::env::var("BW_LIQUIPEDIA_USER_AGENT") {
        if !ua.is_empty() {
            s.liquipedia_user_agent = ua;
        }
    } else {
        s.liquipedia_user_agent = DEFAULT_USER_AGENT.to_string();
    }
    if let Some(rl) = std::env::var("BW_LIQUIPEDIA_RATE_LIMIT_MS")
        .ok()
        .and_then(|v| v.parse::<u64>().ok())
    {
        s.rate_limit_ms = rl.max(2000);
    }
    s
}

fn collect_titles() -> Vec<String> {
    let argv: Vec<String> = std::env::args().skip(1).collect();
    if !argv.is_empty() {
        return argv;
    }
    let stdin = io::stdin();
    let mut titles = Vec::new();
    for line in stdin.lock().lines() {
        let line = match line {
            Ok(l) => l,
            Err(err) => {
                eprintln!("stdin read error: {err}");
                continue;
            }
        };
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        titles.push(trimmed.to_string());
    }
    titles
}

#[tokio::main(flavor = "current_thread")]
async fn main() -> io::Result<()> {
    let titles = collect_titles();
    if titles.is_empty() {
        eprintln!("usage: scrape <title> [<title>...] OR pipe newline-separated titles on stdin");
        std::process::exit(2);
    }

    let settings = settings_from_env();
    let stdout = io::stdout();
    let mut out = stdout.lock();
    for title in titles {
        let record = scrape_one(&title, &settings).await;
        let line = serde_json::to_string(&record)
            .unwrap_or_else(|err| format!(r#"{{"title":{:?},"error":"serde:{}"}}"#, title, err));
        writeln!(out, "{}", line)?;
        out.flush()?;
    }
    Ok(())
}

async fn scrape_one(title: &str, settings: &Settings) -> ScrapeRecord {
    let canonical = match api::parse_liquipedia_title(title) {
        Ok(t) => t,
        Err(err) => {
            return ScrapeRecord {
                title: title.to_string(),
                page_title: title.to_string(),
                revision_id: None,
                revision_timestamp: None,
                builds: Vec::new(),
                error: Some(format!("parse-title: {err}")),
                outcome: "fetch-error",
            }
        }
    };
    eprintln!("scrape: {canonical}");
    let page = match api::get_page_wikitext(&canonical, settings).await {
        Ok(p) => p,
        Err(err) => {
            return ScrapeRecord {
                title: title.to_string(),
                page_title: canonical,
                revision_id: None,
                revision_timestamp: None,
                builds: Vec::new(),
                error: Some(err.to_string()),
                outcome: "fetch-error",
            }
        }
    };
    let parsed = parser::parse_liquipedia_page(&page.page_title, &page.wikitext);
    let builds = import::builds_from_page(&page.page_title, &parsed, page.revision_id);
    let outcome = if builds.is_empty() {
        "no-template-no-fallback"
    } else {
        "ok"
    };
    ScrapeRecord {
        title: title.to_string(),
        page_title: page.page_title,
        revision_id: page.revision_id,
        revision_timestamp: page.revision_timestamp,
        builds,
        error: None,
        outcome,
    }
}
