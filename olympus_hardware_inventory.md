---
status: inventory_current
completed_on:
last_reviewed: 2026-05-27
open_followups: router reservations pending
---

# Olympus Homelab Inventory

_Last updated: 2026-05-27_

## 1. Workstation

### System Summary

| Attribute | Value |
|---|---|
| Hostnames | `ares` (Windows boot) / `apollo` (Linux boot) |
| Type | Dual-boot workstation (single physical machine, two OS installs) |
| Role | Desktop, gaming, development, AI/GPU workloads, SSH client to zeus |
| Tailscale | Both `ares` and `apollo` are tailnet members |

### Hardware

| Component | Specification |
|---|---|
| CPU | AMD Ryzen 9 5900X |
| Cores / Threads | 12 / 24 |
| RAM | 64 GiB |
| GPU | NVIDIA GeForce RTX 3090 |
| Motherboard | ASUS ROG CROSSHAIR VIII HERO (WI-FI) |
| Network | Realtek PCIe 2.5GbE (currently linked at 1 Gbps) |

### Storage

| Drive | Capacity | Type |
|---|---:|---|
| Samsung SSD 980 PRO | 500 GB | NVMe SSD |
| Samsung SSD 990 PRO | 2 TB | NVMe SSD |
| Samsung SSD 850 PRO | 1 TB | SATA SSD |

---

## 2. Server: zeus

### System Summary

| Attribute | Value |
|---|---|
| Hostname | `zeus` |
| Type | Rack Server |
| Model | Dell PowerEdge R420 |
| Role | Primary Proxmox virtualization / storage server |
| Hypervisor | Proxmox VE 9.1 (Debian 13 Trixie base) |
| LAN IP | `192.168.0.113` on `vmbr0` |
| Tailscale | Member of `egret-chimaera.ts.net` |

### Hardware

| Component             | Specification          |
| --------------------- | ---------------------- |
| CPU                   | 2 × Intel Xeon E5-2470 |
| Total Cores / Threads | 16 / 32                |
| RAM                   | 120 GiB                |
| GPU / Video           | Matrox G200eR2 onboard (no compute GPU) |
| Firmware              | Dell BIOS 2.9.0        |
| Out-of-band mgmt      | iDRAC NIC currently unplugged (deferred — see `leftovers.md`) |

### Network Interfaces

| Interface | Specification | State |
|---|---|---|
| NIC 1 | Broadcom BCM5720 1 GbE | Active in `vmbr0` |
| NIC 2 | Broadcom BCM5720 1 GbE | Down (unused) |
| NIC 3 | Aquantia AQC113CS 10 GbE | Down (unused — workstation link is 1 Gbps anyway) |
| iDRAC | Dedicated BMC NIC | Unplugged |

### Storage Layout

#### Boot Pool

| Pool | Layout | Drives |
|---|---|---|
| `rpool` | ZFS Mirror | 2 × Samsung 870 QVO 4TB |

#### Data Pool

| Pool | Layout | Drives |
|---|---|---|
| `zeus-datapool` | RAIDZ2 | 6 × 4TB SSDs |

##### Drives in Data Pool

| Model | Count |
|---|---:|
| Samsung SSD 860 EVO 4TB | 5 |
| Samsung SSD 870 QVO 4TB | 1 |

#### ZFS Datasets (under `zeus-datapool`)

| Dataset | Purpose | Tuning | Notes |
|---|---|---|---|
| `vms` | VM/LXC disks | `recordsize=64K`, `lz4` | Proxmox storage `vms` (`pool zeus-datapool/vms`) |
| `media` | Plex library | `recordsize=1M`, `compression=off` | SMB-shared via fileserver LXC for ingest; read-only bind mount into CT 120 `plex` |
| `iso` | ISO library | `recordsize=1M`, `lz4` | Proxmox Directory storage `iso`; SMB-shared via fileserver LXC |
| `personal` | Docs, backups | `recordsize=128K`, `zstd` | SMB-shared via fileserver LXC. Subdirs: `claude/`, `gabby-backup/`, `notes/` |

> **Decommissioned (file 02.8):** the legacy `dump` dataset and the pool-root `zeus-datapool` Proxmox storage entry. Migration history: dump held the original SMB share; contents were rsync'd into `personal/`, `iso/`, and `media/` per 02.5 Step 3, then dump and the pool-root storage entry were destroyed in 02.8 Step 3.

### Containers / VMs

| ID | Hostname | OS | Type | Role | LAN IP | MAC | Tailnet name |
|---|---|---|---|---|---|---|---|
| 110 | `fileserver` | Debian 13 | Unprivileged LXC | Samba server (`personal`, `iso` shares) | `192.168.0.186` (DHCP — pin at router) | `BC:24:11:9C:9C:CE` | `fileserver.egret-chimaera.ts.net` |
| 120 | `plex` | Debian 13 | Unprivileged LXC | Plex Media Server | `192.168.0.154` (DHCP — pin at router) | `BC:24:11:73:DC:70` | `plex.egret-chimaera.ts.net` |
| 201 | `seafile` | Ubuntu 24.04 | VM | File sync (Seafile) | `192.168.0.85` (DHCP — pin at router) | `BC:24:11:E7:91:CA` | `seafile.egret-chimaera.ts.net` |

> Future containers will be added to this table as they're provisioned. Each new LXC follows `base-lxc-setup.md` before any app-specific setup.

---

## 3. Network

### LAN

| Attribute | Value |
|---|---|
| Subnet | `192.168.0.0/16` |
| Notable hosts | `zeus` (192.168.0.113), workstation (DHCP), fileserver LXC (DHCP — pin at router), plex LXC (DHCP — pin at router), seafile VM (DHCP — pin at router) |
| Bridge on zeus | `vmbr0` (NIC 1) |

### Tailscale Mesh

| Attribute | Value |
|---|---|
| Tailnet | `egret-chimaera.ts.net` |
| MagicDNS | Enabled |
| HTTPS certs | Enabled (Let's Encrypt via `tailscale cert`) |
| Members | `zeus`, `ares`, `apollo`, `fileserver`, `seafile`, `plex` |
| Key expiry | Disabled on `zeus`, `fileserver`, `seafile`, and `plex` (headless); enabled on `ares`/`apollo` |

---

## Hardware Role Summary

| System | Primary Strength |
|---|---|
| Workstation | GPU compute, desktop workloads, development |
| zeus | Virtualization, SSD storage, self-hosted services |

---

## Current Assessment

### Strengths

- All-SSD ZFS storage pools
- RAIDZ2 redundancy on main datapool
- 10 GbE available for high-speed networking (when other side is upgraded)
- Large RAM capacity for VMs and containers
- Separate powerful GPU workstation
- Tailscale mesh providing secure remote access without port-forwarding

### Constraints

- Older Xeon platform with lower efficiency
- DDR3 generation memory
- Likely higher idle power draw than modern hardware
- Consumer workstation currently linked at only 1 Gbps
- No GPU on zeus → Plex on CT 120 is CPU-transcode only
- iDRAC unplugged → no out-of-band recovery if zeus loses LAN access (mitigated by physical console)

### Likely Bottleneck

CPU age on `zeus`, especially Plex transcoding. Storage is not the current bottleneck.
