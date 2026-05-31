---
status: inventory_current
completed_on:
last_reviewed: 2026-05-27
open_followups: CT 110 ssh.socket audit, Seafile desktop clients, router reservations, and Plane deployment pending
---

# Olympus Homelab Software Inventory

_Last updated: 2026-05-27_

Companion to `olympus_hardware_inventory.md`. Tracks what's *running* on each host (services, versions, config paths) — the dynamic side, vs the hardware/storage layout that lives in the hardware inventory.

Update whenever you install / remove / upgrade a service or change a version-pinned config.

---

## How to use this doc

- One section per host. Each section has the same shape: OS, services table, host-specific notes.
- Services table columns: name, version, config, status, notes. Keep it terse — full config explanations belong in the per-service doc.
- For "version" use what `apt list --installed | grep <pkg>` or the service's own `--version` reports. Update on every upgrade.
- "Last verified" date at the top of each host's section is when the table was sanity-checked end-to-end.

---

## 1. zeus (Proxmox host)

**OS:** Proxmox VE 9.1 (Debian 13 Trixie base)  
**Last verified:** 2026-04-27

| Service | Version | Config | Status | Notes |
|---|---|---|---|---|
| Proxmox VE | 9.1 | `/etc/pve/` | active | Hypervisor |
| `pve-firewall` | bundled | `/etc/pve/firewall/` | enabled/running | Per-VM/CT rules |
| ZFS | 2.x (kernel) | `/etc/zfs/` | active | rpool (boot mirror) + zeus-datapool (RAIDZ2) |
| `smartd` | 7.x | `/etc/smartd.conf` | enabled | Disk health → email alerts via msmtp |
| `msmtp` | — | `/etc/msmtprc` | mta | Gmail App Password relay |
| Tailscale | auto (apt) | `/etc/default/tailscaled` | active | Tailnet `egret-chimaera.ts.net`, key expiry disabled |
| `sshd` | OpenSSH 9.x | `/etc/ssh/sshd_config` | active | LAN + tailnet, key-only, no root login |
| `unattended-upgrades` | 2.x | `/etc/apt/apt.conf.d/` | enabled | Security-only, no auto-reboot |
| `fail2ban` | — | n/a | not installed | Per-LXC/VM only — see leftovers (CrowdSec swap is the path-forward) |

**Notable host-only configs:**

- ZFS scheduled scrub via cron (`/etc/cron.d/zfsutils-linux`)
- iDRAC unplugged (see `leftovers.md`)
- Aliases: `/etc/aliases` routes `root` → `k-proxmox@pm.me` via msmtp

---

## 2. CT 110 — fileserver

**OS:** Debian 13.1-2 (LXC, unprivileged, shared kernel with zeus)  
**Tailnet name:** `fileserver.egret-chimaera.ts.net`  
**LAN IP:** `192.168.0.186` (DHCP — pin at router)  
**Last verified:** 2026-04-27

| Service | Version | Config | Status | Notes |
|---|---|---|---|---|
| Samba | 4.21 | `/etc/samba/smb.conf` | active | SMB3 only, `disable netbios = yes`, `smb ports = 445` |
| `fail2ban` | 1.x (Debian 13) | `/etc/fail2ban/jail.local` | enabled | sshd + samba jails; samba filter at `/etc/fail2ban/filter.d/samba.conf` (created manually — not shipped) |
| Tailscale | auto | — | active | `tag:fileserver`, key expiry disabled |
| `sshd` | OpenSSH | n/a | **masked** | Tailscale SSH only; `ssh.socket` audit still pending in `leftovers.md` |
| `unattended-upgrades` | enabled | `/etc/apt/apt.conf.d/` | enabled | Security-only |
| `console-getty` | systemd | — | active | Requires `nesting=1,keyctl=1` LXC features |
| `postfix` | — | — | **purged** | Removed after fail2ban install (Recommends pulled it in) |

**LXC features:** `nesting=1,keyctl=1`, unprivileged, UID shift +100000.

**Bind mounts (host → container):**

| Host path | Container path | Host UID owner |
|---|---|---|
| `/zeus-datapool/personal` | `/srv/personal` | 101001 (smbuser) |
| `/zeus-datapool/iso` | `/srv/iso` | 101001 (smbuser) |
| `/zeus-datapool/media` | `/srv/media` | 101001 (smbuser; Plex reads via CT 120 read-only mount) |

**Per-LXC firewall:** `/etc/pve/firewall/110.fw` — default DROP in, ACCEPT out, allow: tailnet 100.64.0.0/10, LAN 192.168.0.0/16:445, ICMP.

**Samba users:** `smbuser` (UID 1001 in container = host UID 101001)

---

## 3. VM 201 — seafile

**OS:** Ubuntu 24.04 Noble (cloud image)  
**Tailnet name:** `seafile.egret-chimaera.ts.net`  
**LAN IP:** `192.168.0.85` (DHCP — pin at router)  
**MAC:** `BC:24:11:E7:91:CA`  
**Status:** Running — web UI reachable; app-level SMTP verified via forgot-password email; desktop clients not installed yet.  
**Last verified:** 2026-05-03

| Service | Version | Config | Status | Notes |
|---|---|---|---|---|
| Docker Engine | 29.4.2 / Compose v5.1.3 | `/etc/docker/` | installed | Use `sudo docker ...`; `k-admin` is not in docker group |
| Seafile (Docker stack) | CE 13.0-latest | `/opt/seafile/{seafile-server.yml,caddy.yml,seadoc.yml,.env}` + `/opt/seafile-data/seafile/conf/seahub_settings.py` | running/healthy | Admin email: `k-proxmox@pm.me`; app SMTP verified |
| Caddy (TLS) | caddy-docker-proxy 2.12-alpine | `/opt/seafile/caddy.yml` + `/opt/seafile/seafile-local.yml` | running/healthy | Serves Tailscale cert from `/etc/seafile/tls/` |
| MariaDB (in Seafile stack) | 10.11 | `/opt/seafile-mysql/db` | running/healthy | Container: `seafile-mysql` |
| Redis (in Seafile stack) | latest image | Docker network only | running | Required for Seafile 13+ |
| `msmtp` | — | `/etc/msmtprc` | installed | Same Gmail App Password as zeus |
| Tailscale | 1.96.4 | — | active | `tag:seafile`; key expiry disabled |
| `sshd` | OpenSSH | n/a | masked | Tailscale SSH only; `ssh.socket` also masked |
| `fail2ban` | 1.x | `/etc/fail2ban/jail.local` | enabled | sshd jail; postfix purge in same step |
| `unattended-upgrades` | 2.x | `/etc/apt/apt.conf.d/` | enabled | Security-only |

**Per-VM firewall:** `/etc/pve/firewall/201.fw` — default DROP in, ACCEPT out, allow: tailnet 100.64.0.0/10, ICMP. **No** LAN allow rules — Tailscale-only access.

**Cron jobs:**
- `/etc/cron.monthly/seafile-cert-renew` — Tailscale cert renewal + msmtp alert on failure
- `/etc/cron.daily/seafile-cert-expiry-check` — daily cert watchdog
- `/etc/cron.daily/seafile-backup` — DB dump + data tarball + msmtp alert on failure; tested 2026-05-03

---

## 4. CT 120 — plex

**OS:** Debian 13.1-2 (LXC, unprivileged, shared kernel with zeus)  
**Tailnet name:** `plex.egret-chimaera.ts.net`  
**LAN IP:** `192.168.0.154` (DHCP — pin at router)  
**MAC:** `BC:24:11:73:DC:70`  
**Status:** Running — Plex web UI loads, libraries scan, LAN clients and Tailscale clients verified.  
**Last verified:** 2026-05-04

| Service | Version | Config | Status | Notes |
|---|---|---|---|---|
| Plex Media Server | auto (official apt repo) | `/var/lib/plexmediaserver/Library/Application Support/Plex Media Server/Preferences.xml` | active/enabled | Server name `Dionysus`; public Remote Access disabled; libraries under `/mnt/media` |
| Tailscale | auto | — | active | `tag:plex`, key expiry disabled; Tailscale Serve HTTPS at `https://plex.egret-chimaera.ts.net` |
| `sshd` | OpenSSH | n/a | masked | Tailscale SSH only; `ssh.socket` also masked |
| `fail2ban` | 1.x | `/etc/fail2ban/jail.local` | enabled | sshd jail only; no Plex jail because auth is via plex.tv |
| `unattended-upgrades` | enabled | `/etc/apt/apt.conf.d/` | enabled | Security-only |
| `postfix` | — | — | **purged** | Removed after fail2ban install (Recommends pulled it in) |

**LXC features:** `nesting=1,keyctl=1`, unprivileged, UID shift +100000.

**Bind mounts (host -> container):**

| Host path | Container path | Mode / owner |
|---|---|---|
| `/zeus-datapool/media` | `/mnt/media` | read-only in CT 120; host owner `101001:101001` so CT 110 `smbuser` can ingest media |

**Per-LXC firewall:** `/etc/pve/firewall/120.fw` — default DROP in, ACCEPT out, allow: tailnet 100.64.0.0/10, LAN Plex ports TCP 32400/8324/32469, LAN discovery UDP 1900/5353/32410-32414, ICMP.

**Backups:** Plex database backups are not wired yet; see `05-plex-setup.md` "What This Doc Intentionally Doesn't Cover."

---

## 5. VM 200 — plane (ready to deploy)

**OS:** Ubuntu 24.04 Noble (planned, not yet deployed)  
**Status:** Runbook prerequisites are satisfied and `04-plane-setup.md` is ready to run; deployment pending.

Planned architecture: Ubuntu cloud image VM, Proxmox per-VM firewall (no UFW), Tailscale `tag:plane`, host Caddy with a Tailscale cert, Plane CE Docker Compose behind Caddy on localhost-only high ports, msmtp alerts, and daily app-level backups. Add a full services table here once deployed.

---

## 6. Tailscale tailnet state

**Tailnet:** `egret-chimaera.ts.net`  
**MagicDNS:** enabled  
**HTTPS certs:** enabled

### ACL — current state

```jsonc
"tagOwners": {
  "tag:fileserver": ["autogroup:admin"],
  "tag:seafile":    ["autogroup:admin"],
  "tag:plex":       ["autogroup:admin"],
  // future: "tag:plane"
},

"ssh": [
  // Default — users to their own untagged devices
  { "action": "check",  "src": ["autogroup:member"], "dst": ["autogroup:self"], "users": ["autogroup:nonroot", "root"] },
  // Admins → tagged servers as k-admin
  { "action": "accept", "src": ["autogroup:admin"],  "dst": ["tag:fileserver"], "users": ["k-admin"] },
  { "action": "accept", "src": ["autogroup:admin"],  "dst": ["tag:seafile"],    "users": ["k-admin"] },
  { "action": "accept", "src": ["autogroup:admin"],  "dst": ["tag:plex"],       "users": ["k-admin"] },
],
```

### Devices

| Hostname | Tag | Tailnet IP | Key expiry | Notes |
|---|---|---|---|---|
| `zeus` | — | 100.114.213.89 | disabled | Hypervisor |
| `ares` | — | 100.85.89.38 | enabled | Windows workstation |
| `apollo` | — | _(assigned when booted)_ | enabled | Linux workstation |
| `fileserver` | `tag:fileserver` | 100.105.231.7 | disabled | CT 110 |
| `seafile` | `tag:seafile` | 100.121.76.19 | disabled | VM 201 |
| `plex` | `tag:plex` | _(record next verification)_ | disabled | CT 120 |

---

## 7. Update protocol

When you install / remove / upgrade something, also:
1. Update the relevant table row above.
2. Bump the `Last verified` date for that host.
3. If it's a major service add (new app on a host, new tailnet device), add a new row or section.
4. If a service moves between hosts, update both old and new sections.

This file is the canonical answer to *"what's running where, what version, where's its config?"* — keep it accurate or it becomes worse than no inventory.
