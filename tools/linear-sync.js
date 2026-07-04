#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
const { execFileSync } = require("node:child_process");
const { existsSync, readdirSync, statSync, readFileSync } = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const configPath = path.join(__dirname, "teammate.config.json");

if (!existsSync(configPath)) {
  console.error("teammate.config.json not found in tools/");
  process.exit(1);
}

const config = JSON.parse(readFileSync(configPath, "utf8"));
const args = process.argv.slice(2);
const shouldPost = args.includes("--post");
const explicitIssue = args.find((arg) => /^[A-Z]+-\d+$/i.test(arg));

function run(command, commandArgs) {
  try {
    return execFileSync(command, commandArgs, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch {
    return "";
  }
}

function slugify(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 56);
}

function inferIssueId() {
  if (explicitIssue) return explicitIssue.toUpperCase();
  const branch = run("git", ["branch", "--show-current"]);
  return branch.match(/[A-Z]+-\d+/i)?.[0]?.toUpperCase() || "";
}

function findScreenshots(dir) {
  if (!existsSync(dir)) return [];
  const found = [];
  function walk(current) {
    for (const item of readdirSync(current)) {
      const full = path.join(current, item);
      const stat = statSync(full);
      if (stat.isDirectory()) walk(full);
      else if (/\.(png|jpg|jpeg|webp|json)$/i.test(item)) found.push(path.relative(root, full));
    }
  }
  walk(dir);
  return found.slice(-40);
}

async function linearGraphql(query, variables) {
  const token = process.env.LINEAR_API_KEY;
  if (!token) throw new Error("LINEAR_API_KEY is required for --post.");
  const response = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: token
    },
    body: JSON.stringify({ query, variables })
  });
  const body = await response.json();
  if (!response.ok || body.errors) throw new Error(JSON.stringify(body.errors || body));
  return body.data;
}

async function loadLinearIssue(issueId) {
  if (!process.env.LINEAR_API_KEY || !issueId) return null;
  const data = await linearGraphql(
    `query Issue($id: String!) { issue(id: $id) { id identifier title branchName } }`,
    { id: issueId }
  );
  return data.issue;
}

async function postComment(issueId, body) {
  const issue = await loadLinearIssue(issueId);
  if (!issue) throw new Error(`Could not load Linear issue ${issueId}.`);
  await linearGraphql(
    `mutation Comment($issueId: String!, $body: String!) { commentCreate(input: { issueId: $issueId, body: $body }) { success } }`,
    { issueId: issue.id, body }
  );
}

async function main() {
  const issueId = inferIssueId();
  const gitStatus = run("git", ["status", "--short"]);
  const diffStat = run("git", ["diff", "--stat"]);
  const currentBranch = run("git", ["branch", "--show-current"]);
  let issue = null;
  if (process.env.LINEAR_API_KEY && issueId) issue = await loadLinearIssue(issueId).catch(() => null);
  const title = issue?.title || args.filter((arg) => !arg.startsWith("--") && arg !== explicitIssue).join(" ") || `${config.name || "teammate"} update`;
  const branchSuggestion = issue?.branchName || `${issueId ? issueId.toLowerCase() + "-" : ""}${slugify(title)}`;
  const screenshots = findScreenshots(path.join(root, config.visualResultsDir || "tools/visual-results"));

  const body = [
    `Branch suggestion: \`${branchSuggestion}\``,
    "",
    `Current branch: \`${currentBranch || "none"}\``,
    "",
    "Git status:",
    "```",
    gitStatus || "clean",
    "```",
    "",
    "Diff stat:",
    "```",
    diffStat || "no working-tree diff",
    "```",
    screenshots.length ? ["", "Visual audit artifacts:", ...screenshots.map((file) => `- ${file}`)].join("\n") : ""
  ].filter(Boolean).join("\n");

  console.log(body);
  if (shouldPost) {
    if (!issueId) throw new Error("Pass a Linear issue id like HAC-123 or run from a branch containing it.");
    await postComment(issueId, body);
    console.log(`Posted update to ${issueId}.`);
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
