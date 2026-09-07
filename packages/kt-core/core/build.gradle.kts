import org.gradle.api.tasks.Exec

plugins {
    alias(libs.plugins.android.library)
    alias(libs.plugins.wire)
    id("maven-publish")
}

group = "org.futo"
// Release CI passes -PktCoreVersion=<tag minus v>; default stays 0.0.0.
version = (findProperty("ktCoreVersion") as? String) ?: "0.0.0"

// ── Paths ──────────────────────────────────────────────────────────────
// Repo root is two levels up from packages/kt-core.
val repoRoot = rootProject.projectDir.parentFile.parentFile
val protosDir = File(repoRoot, "protos")
val uniffiOutDir = layout.buildDirectory.dir("generated/uniffi").get().asFile
val jniLibsDir = File(projectDir, "src/main/jniLibs")
val skipRust = (findProperty("skipRust") as? String) == "true"

android {
    namespace = "org.futo.polycentric.core"
    compileSdk = 35

    defaultConfig {
        minSdk = 24
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        consumerProguardFiles("consumer-rules.pro")
    }

    sourceSets {
        getByName("main") {
            kotlin.srcDir(uniffiOutDir)
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    packaging {
        // JNA ships per-ABI dispatch libs; keep first occurrence.
        jniLibs.pickFirsts += listOf("**/libjnidispatch.so")
        // rs-common also builds as a cdylib and cargo-ndk copies it, but
        // its code is statically linked into libpolycentric_core.so
        // (readelf -d shows no NEEDED entry for it) — don't ship it.
        jniLibs.excludes += listOf("**/libpolycentric_common.so")
    }

    publishing {
        singleVariant("release")
    }
}

// ── Protobuf (Wire) ────────────────────────────────────────────────────
// Generates Kotlin message classes from the SAME .proto files the server,
// js-core, and rs-core are generated from. Only v2 is needed; the legacy
// protos/polycentric.proto (v1) is intentionally excluded — pull it in
// only if this library grows a v1→v2 migration surface.
wire {
    sourcePath {
        srcDir(protosDir.absolutePath)
        include("polycentric/v2/*.proto")
    }
    kotlin {
        javaInterop = false
        // Messages only — no gRPC service stubs. Transport lives in
        // rs-core (native tonic); stubs would drag in wire-grpc-client.
        rpcRole = "none"
    }
}

// ── Rust: cross-compile rs-core for Android ────────────────────────────
// Requires: rustup targets (aarch64/armv7/i686/x86_64-linux-android),
// cargo-ndk (`cargo install cargo-ndk`), and $ANDROID_NDK_HOME.
val cargoNdkBuild = tasks.register<Exec>("cargoNdkBuild") {
    group = "rust"
    description = "Cross-compile rs-core (cdylib) for all Android ABIs via cargo-ndk"
    workingDir = repoRoot
    commandLine(
        "cargo", "ndk",
        "-t", "arm64-v8a",
        "-t", "armeabi-v7a",
        "-t", "x86",
        "-t", "x86_64",
        "-o", jniLibsDir.absolutePath,
        "build", "--release",
        "-p", "polycentric-core",
    )
    inputs.dir(File(repoRoot, "packages/rs-core/src"))
    inputs.dir(File(repoRoot, "packages/rs-common/src"))
    outputs.dir(jniLibsDir)
}

// ── Rust: host build + Kotlin binding generation ───────────────────────
// uniffi-bindgen reads exported symbols from a HOST cdylib (any target
// works; host is fastest), then emits Kotlin into build/generated/uniffi.
// Package/name mapping comes from uniffi.toml next to this file.
val cargoHostBuild = tasks.register<Exec>("cargoHostBuild") {
    group = "rust"
    description = "Build rs-core for the host so uniffi-bindgen can read its metadata"
    workingDir = repoRoot
    commandLine("cargo", "build", "--release", "-p", "polycentric-core")
}

val uniffiGenerate = tasks.register<Exec>("uniffiGenerate") {
    group = "rust"
    description = "Generate Kotlin bindings for rs-core with uniffi-bindgen"
    dependsOn(cargoHostBuild)
    workingDir = repoRoot
    // Linux host library name; use libpolycentric_core.dylib on macOS.
    val hostLib = File(repoRoot, "target/release/libpolycentric_core.so")
    commandLine(
        "cargo", "run", "--release",
        "--manifest-path", File(repoRoot, "tools/uniffi-bindgen/Cargo.toml").absolutePath,
        "--",
        "generate",
        "--library", hostLib.absolutePath,
        "--language", "kotlin",
        "--config", File(projectDir, "uniffi.toml").absolutePath,
        "--out-dir", uniffiOutDir.absolutePath,
        "--no-format",
    )
    // Regenerate when the host cdylib (rs-core's exported FFI) changes;
    // without this input the task is wrongly cached and stale bindings persist.
    inputs.file(hostLib)
    outputs.dir(uniffiOutDir)
}

if (!skipRust) {
    tasks.named("preBuild") {
        dependsOn(cargoNdkBuild, uniffiGenerate)
    }
}

dependencies {
    implementation(libs.kotlinx.coroutines.core)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.wire.runtime)
    implementation(libs.okhttp)
    implementation(libs.bouncycastle)
    // uniffi Kotlin runtime dependency:
    implementation(libs.jna) { artifact { type = "aar" } }

    testImplementation(libs.junit)
    // android.jar's org.json is a throwing stub on the host JVM; unit tests
    // that exercise Moderation (and decode JWT segments) need the real one.
    testImplementation(libs.orgjson)
    androidTestImplementation(libs.androidx.test.runner)
}

// ── Publishing ─────────────────────────────────────────────────────────
// Publishes the release AAR to the GitLab Maven registry from the
// kt-core-publish CI job on release tags.
afterEvaluate {
    publishing {
        publications {
            register<MavenPublication>("release") {
                from(components["release"])
                groupId = "org.futo"
                artifactId = "polycentric-core"
            }
        }
        if (System.getenv("CI_JOB_TOKEN") != null) {
            repositories {
                maven {
                    name = "GitLab"
                    url = uri(
                        "${System.getenv("CI_API_V4_URL")}/projects/" +
                            "${System.getenv("CI_PROJECT_ID")}/packages/maven",
                    )
                    credentials(HttpHeaderCredentials::class) {
                        name = "Job-Token"
                        value = System.getenv("CI_JOB_TOKEN")
                    }
                    authentication {
                        create<HttpHeaderAuthentication>("header")
                    }
                }
            }
        }
    }
}
