# Claude Code Daily Digest

An automated daily intelligence briefing about the Claude Code ecosystem, delivered to your Obsidian vault every morning.

## What You Get

- **Daily digest** with trending GitHub skills, YouTube videos, and Reddit discussions
- **AI-powered summaries** (Claude Haiku) with personalized relevance scoring
- **Trend velocity tracking** — see what's accelerating, not just what exists
- **One-click install commands** for every GitHub skill
- **Cross-day wikilinks** connecting related topics across digests
- **Weekly rollup** every Sunday — a narrative newsletter summarizing the week
- **Obsidian-native** with Dataview-compatible frontmatter, callouts, and tags

## Setup

### 1. Create a GitHub repo

Create a new **private** repo (e.g., `dailyDigestClaudeCode`) and push this project to it:

```bash
git remote add origin https://github.com/YOUR_USERNAME/dailyDigestClaudeCode.git
git branch -M main
git push -u origin main
```

### 2. Add API secrets

Go to your repo's **Settings > Secrets and variables > Actions** and add:

| Secret | Required | How to get |
|--------|----------|------------|
| `ANTHROPIC_API_KEY` | Yes | [console.anthropic.com](https://console.anthropic.com/) |
| `YOUTUBE_API_KEY` | Yes | [Google Cloud Console](https://console.cloud.google.com/) > Enable YouTube Data API v3 > Create API key |

`GITHUB_TOKEN` is automatically provided by GitHub Actions.

### 3. Enable the GitHub Action

The workflow at `.github/workflows/digest.yml` runs daily at 10:00 UTC (6 AM ET).

To test it immediately: **Actions tab > Daily Claude Code Digest > Run workflow**.

### 4. Set up Obsidian on your Mac

```bash
# Clone the repo to your desired vault location
git clone https://github.com/YOUR_USERNAME/dailyDigestClaudeCode.git ~/Desktop/dailyDigestClaudeCode
```

1. Open Obsidian > **Open folder as vault** > select `~/Desktop/dailyDigestClaudeCode`
2. Install the **Obsidian Git** community plugin
3. Configure Obsidian Git: **Auto-pull interval: 30 minutes**

### 5. Set up Obsidian on your iPhone (optional)

1. Install **Working Copy** (iOS git client) from the App Store
2. Clone `https://github.com/YOUR_USERNAME/dailyDigestClaudeCode.git` in Working Copy
3. Install **Obsidian** from the App Store
4. In Obsidian Mobile: **Open folder as vault** > select the Working Copy repo folder
5. Pull manually in Working Copy when you want the latest digest

## Customize

Edit `config.json` to personalize:

- **Search terms** — what to track on each platform
- **Profile** — your goals, skill level, interests (feeds into AI recommendations)
- **Velocity threshold** — what counts as "high signal"
- **Source weights** — prioritize GitHub over Reddit, etc.

## Run Locally

```bash
npm install
ANTHROPIC_API_KEY=your-key YOUTUBE_API_KEY=your-key npx tsx src/index.ts
```

## Cost

- **GitHub Actions**: Free (uses ~30 min/month of 2000 min free tier)
- **Claude Haiku**: ~$1-2/month (batched API calls)
- **YouTube API**: Free (uses ~1% of daily quota)
