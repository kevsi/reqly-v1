import JSZip from "jszip";

export interface SdkManifestInput {
  /** OpenAPI Generator id, e.g. "typescript-fetch", "python", "go". */
  generator: string;
  /** Human-friendly API/collection name used to derive package names. */
  apiName: string;
  /** Default server URL (baked into docs where relevant). */
  basePath?: string;
  /** Package version (default "1.0.0"). */
  version?: string;
}

/** Sanitize an arbitrary string into a safe, lowercase identifier. */
function slugify(raw: string): string {
  return (
    raw
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "api"
  );
}

function npmName(apiName: string): string {
  return `reqly-${slugify(apiName)}`;
}

function pythonName(apiName: string): string {
  return `reqly_${slugify(apiName).replace(/-/g, "_")}`;
}

/**
 * Produce build manifests (package.json, tsconfig.json, pyproject.toml, …)
 * for a generated SDK so it is usable out of the box. OpenAPI Generator does
 * not emit these for every target, so Reqly injects them.
 *
 * Pure and deterministic — safe to unit test without network or a real ZIP.
 */
export function buildSdkManifests(input: SdkManifestInput): Record<string, string> {
  const { generator, apiName, basePath, version = "1.0.0" } = input;
  const g = (generator || "").toLowerCase();

  if (g.startsWith("typescript")) {
    const pkg = {
      name: npmName(apiName),
      version,
      description: `TypeScript client generated from the Reqly '${apiName}' collection.`,
      type: "module" as const,
      main: "./dist/index.js",
      types: "./dist/index.d.ts",
      exports: {
        ".": { types: "./dist/index.d.ts", import: "./dist/index.js" },
      },
      files: ["dist"],
      scripts: {
        build: "tsc -p tsconfig.json",
        typecheck: "tsc -p tsconfig.json --noEmit",
      },
      license: "MIT",
      devDependencies: { typescript: "^5.0.0" },
    };
    const tsconfig = {
      compilerOptions: {
        target: "ES2020",
        module: "ESNext",
        moduleResolution: "Bundler",
        lib: ["ES2020", "DOM"],
        declaration: true,
        outDir: "dist",
        rootDir: ".",
        strict: false,
        esModuleInterop: true,
        skipLibCheck: true,
        forceConsistentCasingInFileNames: true,
        resolveJsonModule: true,
      },
      include: ["index.ts", "runtime.ts", "apis/**/*.ts", "models/**/*.ts"],
      exclude: ["node_modules", "dist"],
    };
    return {
      "package.json": JSON.stringify(pkg, null, 2) + "\n",
      "tsconfig.json": JSON.stringify(tsconfig, null, 2) + "\n",
    };
  }

  if (g === "python") {
    const name = pythonName(apiName);
    const toml = `[build-system]
requires = ["setuptools>=61.0"]
build-backend = "setuptools.build_meta"

[project]
name = "${name}"
version = "${version}"
description = "Python client generated from the Reqly '${apiName}' collection"
requires-python = ">=3.8"
dependencies = [
    "urllib3 >= 1.25.3",
    "certifi",
    "python-dateutil",
    "pydantic >= 2.0",
]
`;
    return { "pyproject.toml": toml };
  }

  if (g === "go") {
    // go.mod du SDK généré. Construit ligne par ligne (pas de tabulation
    // ni de contenu interpoleisable par un shell — contenu statique).
    const moduleLine = "module github.com/reqly/" + slugify(apiName);
    const requireLine = "  github.com/antihax/" + "optional v1.0.0";
    const mod = [
      moduleLine,
      "",
      "go 1.21",
      "",
      "require (",
      requireLine,
      ")",
      "",
    ].join("\n");
    return { "go.mod": mod };
  }

  if (g === "rust") {
    const name = npmName(apiName);
    const cargo = `[package]
name = "${name}"
version = "${version}"
edition = "2021"
description = "Rust client generated from the Reqly '${apiName}' collection"
license = "MIT"

[dependencies]
reqwest = { version = "0.12", features = ["json", "multipart"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
serde_repr = "0.1"
`;
    return { "Cargo.toml": cargo };
  }

  if (g === "java") {
    const pom = `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 http://maven.apache.org/xsd/maven-4.0.0.xsd">
  <modelVersion>4.0.0</modelVersion>
  <groupId>com.reqly</groupId>
  <artifactId>${slugify(apiName).replace(/[._-]+/g, "-")}-client</artifactId>
  <version>${version}</version>
  <packaging>jar</packaging>
  <name>Reqly ${apiName} client</name>
  <properties>
    <maven.compiler.source>11</maven.compiler.source>
    <maven.compiler.target>11</maven.compiler.target>
    <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>
  </properties>
  <dependencies>
    <dependency>
      <groupId>com.squareup.okhttp3</groupId>
      <artifactId>okhttp</artifactId>
      <version>4.12.0</version>
    </dependency>
    <dependency>
      <groupId>com.google.code.gson</groupId>
      <artifactId>gson</artifactId>
      <version>2.11.0</version>
    </dependency>
  </dependencies>
</project>
`;
    return { "pom.xml": pom };
  }

  if (g === "csharp") {
    const proj = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
    <PackageId>Reqly.${slugify(apiName).replace(/[^a-z0-9]/gi, "")}.Client</PackageId>
    <Version>${version}</Version>
    <Description>Reqly ${apiName} client</Description>
  </PropertyGroup>
</Project>
`;
    return { "Reqly.Client.csproj": proj };
  }

  if (g === "php") {
    const composer = `{
  "name": "reqly/${slugify(apiName).replace(/[._]+/g, "-")}-client",
  "description": "Reqly ${apiName} client",
  "version": "${version}",
  "type": "library",
  "license": "MIT",
  "require": {
    "php": ">=8.1",
    "guzzlehttp/guzzle": "^7.8"
  },
  "autoload": {
    "psr-4": {
      "Reqly\\\\Client\\\\": "lib/"
    }
  }
}
`;
    return { "composer.json": composer };
  }

  if (g === "kotlin") {
    const gradle = `plugins {
    id("org.jetbrains.kotlin.jvm") version "1.9.24"
    id("maven-publish")
}

group = "com.reqly"
version = "${version}"

repositories { mavenCentral() }

dependencies {
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("com.google.code.gson:gson:2.11.0")
}
`;
    return { "build.gradle.kts": gradle };
  }

  if (g === "swift5") {
    const swiftName =
      "Reqly" +
      slugify(apiName)
        .split(/[^a-z0-9]+/)
        .filter(Boolean)
        .map((part) => part[0].toUpperCase() + part.slice(1))
        .join("") +
      "Client";
    const pkg = `// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "${swiftName}",
    platforms: [.macOS(.v12), .iOS(.v15)],
    products: [
        .library(name: "ReqlyClient", targets: ["ReqlyClient"])
    ],
    dependencies: [
        .package(url: "https://github.com/Alamofire/Alamofire.git", from: "5.9.0")
    ],
    targets: [
        .target(
            name: "ReqlyClient",
            dependencies: ["Alamofire"],
            path: "Sources/ReqlyClient"
        )
    ]
)
`;
    return { "Package.swift": pkg };
  }

  if (g === "ruby") {
    const gemspec = `# frozen_string_literal: true

require_relative "lib/reqly_client/version"

Gem::Specification.new do |spec|
  spec.name = "reqly_${slugify(apiName).replace(/-/g, "_")}_client"
  spec.version = "${version}"
  spec.summary = "Reqly ${apiName} client"
  spec.license = "MIT"
  spec.authors = ["Reqly"]
  spec.require_paths = ["lib"]
  spec.add_dependency "faraday", ">= 2.0"
end
`;
    return { "reqly_client.gemspec": gemspec };
  }

  if (g === "dart") {
    const pubspec = `name: reqly_${slugify(apiName).replace(/-/g, "_")}_client
version: ${version}
description: Reqly ${apiName} client
publish_to: none

environment:
  sdk: '>=3.0.0 <4.0.0'

dependencies:
  http: ^1.2.0

dev_dependencies:
  lints: ^4.0.0
`;
    return { "pubspec.yaml": pubspec };
  }

  // Generic fallback: a README so the SDK is at least navigable.
  const readme = `# Reqly generated SDK — ${apiName}

Generator: ${generator}
${basePath ? `Default base path: ${basePath}\n` : ""}
This SDK was generated from a Reqly collection. Build instructions depend on
the target language (\`${generator}\`). Refer to the OpenAPI Generator docs for
'${generator}'.
`;
  return { "README.md": readme };
}

/**
 * Detect the common top-level directory the generator nested its files in
 * (some generators wrap output in a folder; typescript-fetch is flat).
 */
function detectBaseDir(zip: JSZip): string {
  const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir);
  if (names.includes("index.ts")) return "";
  const nested = names.find((n) => /^[^/]+\/index\.ts$/.test(n));
  return nested ? nested.split("/")[0] + "/" : "";
}

/**
 * Merge build manifests into a generated SDK ZIP. Existing files are never
 * overwritten, so a generator-provided manifest is preserved.
 *
 * @returns the (possibly) enriched ZIP as bytes. Throws on malformed input —
 *          callers should fall back to the original bytes.
 */
export async function enrichZipWithManifests(
  buffer: ArrayBuffer,
  generator: string,
  apiName: string,
  basePath?: string,
): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(buffer);
  const base = detectBaseDir(zip);
  const manifests = buildSdkManifests({ generator, apiName, basePath });
  for (const [path, content] of Object.entries(manifests)) {
    const target = base + path;
    if (!zip.file(target)) {
      zip.file(target, content);
    }
  }
  return zip.generateAsync({ type: "uint8array" });
}
