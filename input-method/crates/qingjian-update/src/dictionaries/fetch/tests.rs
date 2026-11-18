use super::*;
use std::net::TcpListener;

fn dir(label: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "wordmate-{label}-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}
fn entry() -> Entry {
    catalog::parse(include_bytes!("../catalog.json"))
        .unwrap()
        .into_iter()
        .find(|e| e.id == "domain-idioms")
        .unwrap()
}
fn archive(root: &Path) -> Vec<u8> {
    let p = root.join("fixture.qj");
    Dictionary::parse("星河\txing he\t30\n")
        .unwrap()
        .write_qj(&p, &Default::default())
        .unwrap();
    let mut gzip = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
    gzip.write_all(&std::fs::read(p).unwrap()).unwrap();
    gzip.finish().unwrap()
}
#[test]
fn catalogue_filters_non_dictionaries_and_rejects_unsafe_ids_and_unknown_schema() {
    let original = include_bytes!("../catalog.json");
    let entries = catalog::parse(original).unwrap();
    assert_eq!(entries.len(), 12);
    assert_eq!(
        entries
            .iter()
            .find(|e| e.id == "domain-it-computing")
            .unwrap()
            .stem(),
        "it_computing"
    );
    let mut value: serde_json::Value = serde_json::from_slice(original).unwrap();
    value["dicts"][0]["id"] = "../user".into();
    assert!(catalog::parse(&serde_json::to_vec(&value).unwrap()).is_err());
    assert!(catalog::parse(br#"{"format":2,"dicts":[]}"#).is_err());
}
#[test]
fn manifest_checks_identity_size_hash_and_part_paths() {
    let e = entry();
    let make = || serde_json::json!({"dict":e.id,"version":e.version,"tag":e.tag,"qj_format":1,"archive":{"bytes":e.bytes,"sha256":"a".repeat(64)},"parts":[{"name":"idioms.qjz","bytes":e.bytes,"sha256":"a".repeat(64)}]});
    let v = make();
    assert!(manifest(&serde_json::to_vec(&v).unwrap(), &e).is_ok());
    for (field, value) in [
        ("tag", serde_json::json!("wrong")),
        ("qj_format", serde_json::json!(2)),
    ] {
        let mut v = make();
        v[field] = value;
        assert!(manifest(&serde_json::to_vec(&v).unwrap(), &e).is_err());
    }
    let mut v = make();
    v["parts"][0]["name"] = "../user.tsv".into();
    assert!(manifest(&serde_json::to_vec(&v).unwrap(), &e).is_err());
    assert!(check(b"abc", 3, &hash(b"abd")).is_err());
    assert!(check(b"abc", 4, &hash(b"abc")).is_err());
    assert!(check(b"abc", 3, &hash(b"abc")).is_ok());
}
#[test]
fn validated_install_is_atomic_and_never_touches_personal_memory() {
    let root = dir("install");
    let online = root.join("dicts/online");
    std::fs::write(root.join("user-words.tsv"), "private sentinel").unwrap();
    let e = entry();
    let bytes = archive(&root);
    install(&e, &bytes, &online).unwrap();
    let dest = online.join("idioms.qj");
    let previous = std::fs::read(&dest).unwrap();
    assert_eq!(
        super::super::installed_version(&online, "idioms"),
        Some(e.version.clone())
    );
    assert!(!super::super::needs_update(&e, &online));
    let mut newer = e.clone();
    newer.version = "1.0.1".into();
    assert!(super::super::needs_update(&newer, &online));
    assert!(install(&e, b"broken gzip", &online).is_err());
    let mut gzip = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
    gzip.write_all(b"not a dictionary").unwrap();
    assert!(install(&e, &gzip.finish().unwrap(), &online).is_err());
    assert_eq!(std::fs::read(&dest).unwrap(), previous);
    assert_eq!(
        std::fs::read_to_string(root.join("user-words.tsv")).unwrap(),
        "private sentinel"
    );
    assert!(!online.join(".idioms.pending").exists());
    assert!(!online.join(".idioms.unpacked").exists());
    std::fs::remove_dir_all(root).unwrap();
}
#[test]
fn bounded_http_stream_rejects_bad_status_oversize_and_truncation() {
    for response in [
        "HTTP/1.1 503 Unavailable\r\nContent-Length: 0\r\n\r\n",
        "HTTP/1.1 200 OK\r\nContent-Length: 100\r\n\r\n",
        "HTTP/1.1 200 OK\r\nContent-Length: 8\r\n\r\nabc",
        "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\nB\r\n01234567890\r\n0\r\n\r\n",
    ] {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            let (mut s, _) = listener.accept().unwrap();
            let mut b = [0; 2048];
            let _ = s.read(&mut b);
            let _ = s.write_all(response.as_bytes());
        });
        let client = reqwest::Client::builder()
            .no_proxy()
            .timeout(Duration::from_secs(2))
            .build()
            .unwrap();
        assert!(
            runtime()
                .unwrap()
                .block_on(get(&client, &format!("http://{addr}"), 10, |_| {}))
                .is_err()
        );
        server.join().unwrap();
    }
}
#[test]
#[ignore = "downloads the official catalogue and idioms dictionary over HTTPS"]
fn real_official_dictionary_download_and_reload() {
    let root = dir("real-online");
    runtime().unwrap().block_on(async {
        let client = client().unwrap();
        let (entries, _) = index(&client).await.unwrap();
        let e = entries.iter().find(|e| e.id == "domain-idioms").unwrap();
        download(&client, e, &root, |_, _| {}).await.unwrap();
        let d = Dictionary::from_path(root.join("idioms.qj")).unwrap();
        assert!(d.len() > 3000);
        assert_eq!(d.metadata().unwrap().version, e.version);
        println!(
            "REAL_DICTIONARY_OK entries={} version={}",
            d.len(),
            e.version
        );
    });
    std::fs::remove_dir_all(root).unwrap();
}
