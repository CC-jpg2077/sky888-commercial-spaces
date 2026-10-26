# SKY888 Commercial Spaces

Tenant request system for Sky Houseware (SKY888), Don Rufino Alonzo Sr. St., Brgy. Poblacion 5, Cotabato City.
Project for CS317 Software Engineering, Group 2.

- **Public site** (`/`): an opening hero that expands as you scroll, available spaces, location, and an online request form.
- **Admin area** (`/admin/`): login, dashboard with request search and filters, accept or decline with a note, space management with photos, and editable contact details.

Built with Node.js, Express and a single SQLite file. There is no build step.

---

## How to run it on your computer

You only need two things: **Node.js** (version 20 or newer) and this project folder.

### Step 1: Install Node.js (once)

Download the **LTS** version from <https://nodejs.org>, run the installer, and keep the default options.
Then close and reopen your terminal and check it worked:

```
node -v
```

It should print `v20` or higher. If it says the command is not found, the install did not finish or the terminal was not reopened.

> Mac users who use Homebrew can run `brew install node` instead.

### Step 2: Get the project

Either download the ZIP from GitHub (green **Code** button, then **Download ZIP**) and unzip it, or clone it:

```
git clone <your-repo-url>
```

### Step 3: Open a terminal inside the project folder

**Windows**
1. Open the project folder in File Explorer.
2. Click the address bar, type `cmd`, and press Enter. A Command Prompt opens already in that folder.
   (Or right-click an empty spot in the folder and choose **Open in Terminal**.)

**Mac**
1. Open **Terminal** (press `Cmd + Space`, type `Terminal`, press Enter).
2. Type `cd ` (with a space), drag the project folder from Finder into the Terminal window, and press Enter.

### Step 4: Install and start

The commands are the same on both systems:

```
npm install
npm start
```

`npm install` is only needed the first time (and again after the code is updated).

When it works you will see:

```
SKY888 is running at http://localhost:3000
Admin area: http://localhost:3000/admin/
```

**On the very first start** the terminal also prints the admin email and a temporary password inside a box. **It is shown only once**, so copy it right away. You will be asked to choose a new password the first time you log in.

### Step 5: Open the site

- Public site: <http://localhost:3000>
- Admin area: <http://localhost:3000/admin/>

To stop the server, click the terminal window and press `Ctrl + C`.

---

## Admin login

The default admin email is `admin@sky888.local`.

**Missed the password, or never saw it?** It only prints when the database is first created. Reset it with:

```
npm run create-admin -- admin@sky888.local
```

This prints a new temporary password (and creates the account if it does not exist). To add another admin:

```
npm run create-admin -- someone@example.com "Their Name"
```

To choose the password yourself instead of getting a generated one:

**Mac**
```
ADMIN_PASSWORD='ChooseSomething123' npm run create-admin -- admin@sky888.local
```

**Windows (Command Prompt)**
```
set ADMIN_PASSWORD=ChooseSomething123
npm run create-admin -- admin@sky888.local
```

**Windows (PowerShell)**
```
$env:ADMIN_PASSWORD='ChooseSomething123'
npm run create-admin -- admin@sky888.local
```

---

## Troubleshooting

| Problem | Fix |
| --- | --- |
| **Windows PowerShell:** `npm.ps1 cannot be loaded because running scripts is disabled` | Use **Command Prompt** (Step 3) instead. Or run `Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned` once in PowerShell and answer `Y`. Or type `npm.cmd install` and `npm.cmd start`. |
| `npm: command not found` (Mac) or `'npm' is not recognized` (Windows) | Node.js is not installed, or the terminal was opened before installing. Do Step 1, then open a new terminal. |
| `npm.cmd: command not found` on Mac | `npm.cmd` is Windows only. On a Mac just use `npm`. |
| `EADDRINUSE` / "address already in use" | An old copy is still running. Stop it with `Ctrl + C` in its terminal, or run on another port: `PORT=3001 npm start` (Mac) / `set PORT=3001` then `npm start` (Windows). |
| The page looks like an old version | Press `Ctrl + Shift + R` (Windows) or `Cmd + Shift + R` (Mac), or open the page in a private window. Also check the terminal is inside the newest folder. |
| I did not see the admin password | See **Admin login** above. |
| Everything is empty after I moved to a new folder | The data lives in the `data` folder. Copy the old `data` folder into the new project folder to keep requests and logins. |
| `npm audit` shows vulnerabilities | Run `npm audit fix`. The packages in this project are already up to date. |

Run the automated tests with `npm test`.

---

## Where your data lives

Everything (requests, spaces, photos, admin accounts) is stored in one file: `data/sky888.db`. It is created automatically on the first start and is **not** part of the repository, so every person who runs the project has their own separate data. Requests sent on one computer do not appear on another.

To back up or share your data, copy that file.

---

## Settings (environment variables)

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | 3000 | Port to listen on (hosts usually set this) |
| `DB_PATH` | `data/sky888.db` | Where the SQLite database file lives |
| `ADMIN_EMAIL` | `admin@sky888.local` | Email of the first admin (first run only) |
| `ADMIN_PASSWORD` | generated | Temporary password of the first admin (first run only) |
| `SEED_SAMPLE` | on | Set to `0` to start with no sample spaces |

---

## Putting it online

The app is one Node process plus one database file, so any host that runs Node works.

1. Push this repository to GitHub and connect it to the host, or upload the folder.
2. Build command: `npm install`. Start command: `npm start`.
3. Set `ADMIN_EMAIL` and `ADMIN_PASSWORD` before the first start.
4. **Keep the database on a persistent disk.** Hosts with a free tier that wipes files on restart will lose the data. Attach a persistent volume and point `DB_PATH` at it, for example `DB_PATH=/data/sky888.db`.
5. Use HTTPS (most hosts do this for you). The login cookie is marked secure automatically when the connection is HTTPS.
6. Back up the database file regularly.

---

## What the client still needs to provide

Nothing is invented. Until the client answers, these stay as placeholders and can be filled in from the admin area without changing code:

- **Contact phone, email and office hours:** Admin > Site details. The public Location section shows "to be announced" until they are filled in.
- **Space sizes, floors, rates and photos:** Admin > Spaces. The sample units (Unit 1 to 3) use the building photo until real photos are uploaded.
- **Rates:** hidden from visitors by default. Turn on "Show monthly rates" in Site details if the client agrees.
- **Directions link:** a Google Maps share link, optional. Without it, the link searches for the address.

## Decisions made without the client (change if they disagree)

- Visitors do not need an account. They send a request and receive a reference number such as `SKY-1001`.
- The request form asks for full name, business name, business type, phone, email, target start date (optional), preferred space and an optional message.
- Only Available spaces can be requested. Reserved and Occupied spaces show as closed.
- A decision is final. Once a request is accepted or declined it cannot be switched.
- Accepting a request can also mark the space Reserved or Occupied in the same step.
- No emails are sent. The manager contacts the applicant by phone or email from the request page.
- The colour scheme is navy blue, at the client's request.

## Security notes

- Passwords are hashed with scrypt. Sessions are random tokens stored hashed, expire after 8 hours, and use HttpOnly, SameSite cookies.
- Login attempts and request submissions are rate limited. The request form has a hidden spam trap.
- Uploaded photos are checked by their file contents (JPG, PNG or WebP only, 5 MB each) and are served with a fixed type.
- Cross-site POSTs are rejected, and a strict Content-Security-Policy is set.

## Folder guide

```
server.js               starts the server
src/app.js              middleware and security headers
src/db.js               database schema and settings
src/auth.js             password hashing and sessions
src/routes/public.js    public API: site data, photos, request form
src/routes/admin.js     admin API: login, requests, spaces, photos, settings
public/index.html       public page (css/site.css, js/site.js)
public/js/scroll-hero.js  the scroll-expansion hero
public/js/rotate-words.js the rotating word in the intro
public/admin/           admin app (index.html, admin.css, admin.js)
scripts/                create-admin.js
test/                   end-to-end tests of the API
```
