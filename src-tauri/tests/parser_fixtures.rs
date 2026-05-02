// Integration tests that pin parser behaviour against real Liquipedia
// wikitext fixtures. The fixtures live in tests/fixtures and were captured
// from the live MediaWiki API; refresh them with:
//   node --input-type=module -e "import {writeFileSync} from 'node:fs'; \
//     const r = await fetch('https://liquipedia.net/starcraft/api.php?action=query&prop=revisions&titles=PAGE&rvprop=content&rvslots=main&format=json&formatversion=2'); \
//     const j = await r.json(); writeFileSync('src-tauri/tests/fixtures/PAGE.wikitext', j.query.pages[0].revisions[0].slots.main.content);"

use bw_build_overlay_lib::liquipedia::import::builds_from_page;
use bw_build_overlay_lib::liquipedia::parser::parse_liquipedia_page;

fn load_fixture(name: &str) -> String {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("fixtures")
        .join(format!("{name}.wikitext"));
    std::fs::read_to_string(&path)
        .unwrap_or_else(|err| panic!("could not load fixture {}: {err}", path.display()))
}

#[test]
fn forge_fe_vs_zerg_splits_into_four_inline_variants() {
    let wikitext = load_fixture("forge_fe_vs_zerg");
    let parsed = parse_liquipedia_page("Forge FE (vs. Zerg)", &wikitext);
    assert_eq!(
        parsed.variants.len(),
        4,
        "Forge FE (vs. Zerg) should split into 4 inline variants (9 Pool / 12 Pool / 12 Hatch / Overpool); got {}: {:#?}",
        parsed.variants.len(),
        parsed.variants.iter().map(|v| &v.variant_name).collect::<Vec<_>>(),
    );
    let names: Vec<String> = parsed
        .variants
        .iter()
        .map(|v| v.variant_name.clone())
        .collect();
    for expected in ["9 Pool", "12 Pool", "12 Hatch", "Overpool"] {
        assert!(
            names.iter().any(|n| n.contains(expected)),
            "expected variant containing {expected:?}, got {names:?}"
        );
    }
    for v in &parsed.variants {
        let prelude_match = v
            .steps
            .iter()
            .any(|s| s.contains("Pylon at Natural Expansion"));
        assert!(
            prelude_match,
            "variant {:?} should include the shared prelude bullets, got {:?}",
            v.variant_name, v.steps
        );
        assert!(
            v.steps.len() >= 6,
            "variant {:?} expected to contain prelude + per-variant bullets, got {} steps",
            v.variant_name,
            v.steps.len()
        );
    }
}

#[test]
fn one_gate_core_vs_terran_splits_into_three_separate_templates() {
    let wikitext = load_fixture("1_gate_core_vs_terran");
    let parsed = parse_liquipedia_page("1 Gate Core (vs. Terran)", &wikitext);
    assert_eq!(
        parsed.variants.len(),
        3,
        "1 Gate Core (vs. Terran) ships three separate {{{{build}}}} templates; got {}",
        parsed.variants.len(),
    );
    // The three templates all share `name="One Gate Cybernetics Core"`; the
    // import-level collision resolver in `builds_from_page` falls back to the
    // ===heading=== (No Zealot / One Zealot / Two Zealots) so each variant
    // gets a unique build name in the catalog.
    let builds = builds_from_page("1 Gate Core (vs. Terran)", &parsed, Some(99999));
    assert_eq!(
        builds.len(),
        3,
        "expected one Build per variant; got {}",
        builds.len()
    );
    let names: Vec<String> = builds.iter().map(|b| b.name.clone()).collect();
    for expected in ["No Zealot", "One Zealot", "Two Zealot"] {
        assert!(
            names.iter().any(|n| n.contains(expected)),
            "expected build name containing {expected:?}, got {names:?}"
        );
    }
    let mut ids: Vec<String> = builds.iter().map(|b| b.id.clone()).collect();
    ids.sort();
    ids.dedup();
    assert_eq!(ids.len(), 3, "build IDs should be distinct");
    assert!(
        builds[1..].iter().all(|b| b.variant_of.is_some()),
        "non-first variants should link to the parent via variantOf"
    );
}

#[test]
fn fourteen_cc_vs_zerg_falls_back_to_supply_bullets() {
    let wikitext = load_fixture("14_cc_vs_zerg");
    let parsed = parse_liquipedia_page("14 CC (vs. Zerg)", &wikitext);
    assert!(
        !parsed.variants.is_empty(),
        "14 CC (vs. Zerg) has no {{{{build}}}} template but supply bullets in the body; the fallback should still produce a build"
    );
    let only = &parsed.variants[0];
    assert!(
        only.steps.len() >= 8,
        "fallback should pick up the bulleted supply steps; got {} steps",
        only.steps.len()
    );
    assert!(
        only.steps.iter().any(|s| s.contains("Command Center")),
        "expected 14/18 Command Center step, got {:?}",
        only.steps
    );
}
