# 🚀 AlgoNest

AlgoNest is a Chrome Extension that automatically captures your accepted LeetCode submissions and syncs them to GitHub — fully organized, documented, and version-controlled with zero manual git commands.

---

## ✨ Features

* ⚡ **Auto-detect submissions** — captures accepted LeetCode solutions in real time
* 📂 **Smart organization** — classifies problems into topic folders (Arrays, DP, Graphs, etc.)
* 📝 **Auto documentation** — generates structured markdown for each problem
* 🔁 **Version control** — handles duplicate submissions (overwrite or versioning)
* 🌙 **Silent mode** — fully automatic commits without user interaction
* 📊 **Progress tracking** — maintains stats (topics, difficulty, streaks)
* 🔐 **No backend required** — uses GitHub REST API directly

---

## 🧠 How It Works

1. Solve a problem on LeetCode
2. Submit and get **Accepted ✅**
3. AlgoNest detects the submission
4. Extracts:

   * Code
   * Language
   * Tags
   * Runtime / memory
5. Classifies problem into a topic
6. Generates:

   * Solution file
   * Markdown explanation
7. Commits everything to your GitHub repo

---

## 🏗️ Tech Stack

```bash
Frontend (Extension UI): React + Vite + Tailwind CSS
Extension Runtime: Chrome Extension (Manifest V3)
State Management: Zustand
Storage: chrome.storage.local
API Integration: GitHub REST API (v3)
Auth: GitHub PAT (Part 1)
Testing: Vitest + Testing Library
```

---

## 📁 Project Structure

```bash
AlgoNest/
│
├── src/
│   ├── popup/              # React UI for extension popup
│   ├── content/            # Content script (LeetCode detection)
│   ├── background/         # Service worker logic
│   ├── services/           # GitHub + processing logic
│   └── stores/             # Zustand state management
│
├── public/
│   └── manifest.json       # Chrome extension config
│
├── dist/                   # Built extension (load this in Chrome)
├── package.json
└── vite.config.ts
```

---

## 🔐 Authentication

For now, AlgoNest uses:

👉 **GitHub Personal Access Token (PAT)**

### Required scopes:

```bash
repo
user:email
```

OAuth support is planned for future versions.

---

## ⚙️ Installation & Setup

### 1. Clone the repo

```bash
git clone https://github.com/Krithika1627/AlgoNest.git
cd AlgoNest
```

### 2. Install dependencies

```bash
npm install
```

### 3. Build the extension

```bash
npm run build
```

### 4. Load in Chrome

```bash
# Open in browser
chrome://extensions
```

* Enable **Developer mode**
* Click **Load unpacked**
* Select the `dist/` folder

---

## 🔑 Connect GitHub

1. Open the extension popup
2. Paste your **GitHub PAT** in the developer option field
3. Enter your target repository:

```bash
username/leetcode-sub
```

4. Connect or create the repo

---

## 🧪 Testing

1. Go to LeetCode
2. Solve a problem
3. Submit solution
4. After ~3 seconds:

👉 In normal mode:

* Popup appears → click **Save & Commit**

👉 In silent mode:

* Auto-commits instantly

---

## ⚙️ Key Implementation Details

* 🧠 Uses **MutationObserver + GraphQL intercept** to detect submissions
* 🔁 Implements **debounce (3s)** to avoid duplicate triggers
* 🔐 Uses **SHA-256 hashing** to prevent duplicate commits
* 📦 Stores data locally via `chrome.storage.local`
* 🔄 Handles failures with retry logic and offline queue

---

## 🚧 Current Status

* ✅ Submission detection
* ✅ GitHub integration (PAT)
* ✅ File generation
* ⚠️ Repo selection / creation UI (in progress)
* ⚠️ Auto README generation (partial)

---

## 🛣️ Roadmap

* 🔗 Full OAuth flow (with secure backend)
* 📊 Advanced analytics (weak topic detection)
* 🤖 AI-generated explanations
* 🌐 Multi-platform support (Codeforces, AtCoder)
* 🧩 Dashboard UI for tracking progress

---

## 💡 Why AlgoNest?

Most developers solve DSA problems but don’t maintain a clean, structured repository.

AlgoNest makes it:

* automatic
* organized
* portfolio-ready

---

## 👩‍💻 Author

Krithika
