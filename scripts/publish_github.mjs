// Publish CostDiff to the public repository lukasdevahive/costdiff: source on `main`, site (web/) on `gh-pages`.
// Usage: node scripts/publish_github.mjs "commit message" [--dry-run]
// Refuses to publish when the site audit fails or the privacy page is incomplete. Internal notes (docs/*.md) are
// never exported: only web/, scripts/, tests/, docs/screens/, README.md, package files and .gitignore.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { audit } from "./check_site.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO = "https://github.com/lukasdevahive/costdiff.git";
const EXPORT = ["web", "scripts", "tests", "README.md", "package.json", "package-lock.json", ".gitignore", path.join("docs", "screens")];
const AUTHOR = ["-c", "user.name=lukasdevahive", "-c", "user.email=lukasdevahive@users.noreply.github.com"];

const message = process.argv[2];
const dry = process.argv.includes("--dry-run");
if (!message || message.startsWith("--")) { console.error('Usage : node scripts/publish_github.mjs "message" [--dry-run]'); process.exit(2); }

const problems = audit();
// (a survey configured while privacy.html lacks its data controller is reported by audit())
try { execFileSync(process.execPath, [path.join(ROOT, "scripts", "configure.mjs"), "--check"], { stdio: "pipe" }); } catch { problems.push("CSP ou _headers différents de la configuration (configure.mjs --check)"); }
const unitTests = fs.readdirSync(path.join(ROOT, "tests")).filter((f) => f.endsWith(".test.mjs")).map((f) => path.join(ROOT, "tests", f));
try { execFileSync(process.execPath, ["--test", ...unitTests], { cwd: ROOT, stdio: "pipe" }); } catch { problems.push("tests unitaires en échec (npm test)"); }
// after a move to another host, gh-pages holds redirect pages: they must not be overwritten by the site
const siteUrl = (fs.readFileSync(path.join(ROOT, "web", "js", "config.js"), "utf8").match(/SITE_URL = "([^"]+)"/) || [])[1];
if (!siteUrl || !new URL(siteUrl).host.endsWith("github.io")) problems.push("l'adresse publique n'est plus GitHub Pages : publier les redirections à la main, pas le site");
if (problems.length) { console.error(`Publication refusée :\n- ${problems.join("\n- ")}`); process.exit(1); }

const git = (cwd, ...args) => execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "inherit"] }).toString().trim();
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "costdiff-publish-"));
try {
  git(dir, "clone", "--quiet", REPO, "repo");
  const repo = path.join(dir, "repo");
  // main: replace the exported paths, keep the repository's own history
  for (const p of EXPORT) fs.rmSync(path.join(repo, p), { recursive: true, force: true });
  for (const p of EXPORT) if (fs.existsSync(path.join(ROOT, p))) fs.cpSync(path.join(ROOT, p), path.join(repo, p), { recursive: true });
  const readme = path.join(repo, "README.md"); // the public clone sits at the repository root
  fs.writeFileSync(readme, fs.readFileSync(readme, "utf8").replace(/cd products\\costdiff\r?\n/, "git clone https://github.com/lukasdevahive/costdiff\ncd costdiff\n"));
  git(repo, "add", "-A");
  const mainChanged = git(repo, "status", "--porcelain") !== "";
  if (mainChanged) git(repo, ...AUTHOR, "commit", "--quiet", "-m", `${message}\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`);
  // gh-pages: exactly the content of web/ plus .nojekyll
  git(repo, "fetch", "--quiet", "origin", "gh-pages");
  git(repo, "checkout", "--quiet", "-B", "gh-pages", "origin/gh-pages");
  for (const f of fs.readdirSync(repo)) if (f !== ".git") fs.rmSync(path.join(repo, f), { recursive: true, force: true });
  fs.cpSync(path.join(ROOT, "web"), repo, { recursive: true });
  fs.writeFileSync(path.join(repo, ".nojekyll"), "");
  git(repo, "add", "-A");
  const pagesChanged = git(repo, "status", "--porcelain") !== "";
  if (pagesChanged) git(repo, ...AUTHOR, "commit", "--quiet", "-m", message);
  console.log(`main : ${mainChanged ? "modifié" : "inchangé"} · gh-pages : ${pagesChanged ? "modifié" : "inchangé"}`);
  if (dry) { console.log("--dry-run : rien n'est poussé"); }
  else if (mainChanged || pagesChanged) { git(repo, "push", "--quiet", "origin", "main", "gh-pages"); console.log("poussé sur GitHub ; GitHub Pages se met à jour en 1 à 2 minutes"); }
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
