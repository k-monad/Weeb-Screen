# Weeb-Screen VM 202 Runbook

This runbook is for the human deploy step. Do not edit `olympus_hardware_inventory.md` or
`olympus_software_inventory.md` until the VM is actually provisioned and verified.

## Target

- Host: `zeus`
- Guest: VM `202`, hostname `weeb-screen`
- OS: Ubuntu 24.04 Noble cloud image
- App path: `/opt/weeb-screen`
- Tailnet name: `weeb-screen.egret-chimaera.ts.net`
- Tailscale tag: `tag:weebscreen`
- App container port: host `127.0.0.1:8787`
- Public service ports inside homelab only: `80`, `443`

## Tailscale ACL Diff For Human Review

Add the tag owner:

```jsonc
"tag:weebscreen": ["autogroup:admin"]
```

Add SSH access matching the existing tagged server rules:

```jsonc
{ "action": "accept", "src": ["autogroup:admin"], "dst": ["tag:weebscreen"], "users": ["k-admin"] }
```

## Provision

1. Create VM `202` on `zeus` using the Ubuntu 24.04 cloud image and storage `vms`.
2. Install Docker Engine, Compose, Tailscale, Caddy dependencies, `msmtp`, `openssl`, and unattended security updates.
3. Join Tailscale using `tag:weebscreen`, then disable key expiry.
4. Pin the LAN DHCP lease at the router.
5. Copy this repo to `/opt/weeb-screen`.
6. Copy `.env.example` to `/opt/weeb-screen/.env`, set a real `WEEBSCREEN_ADMIN_TOKEN`, and set mode `600`.
7. Install `/etc/pve/firewall/202.fw` from `deploy/202.fw` on `zeus`; verify default DROP in / ACCEPT out.
8. Create `/etc/weebscreen/tls`, run `tailscale cert` for `weeb-screen.egret-chimaera.ts.net`, and verify key perms are `600`.
9. From `/opt/weeb-screen`, run `sudo docker compose up -d --build`.
10. Smoke test `https://weeb-screen.egret-chimaera.ts.net/healthz` from tailnet and LAN.

## Cron

Install:

- `deploy/cron/weebscreen-backup` to `/etc/cron.daily/weebscreen-backup`
- `deploy/cron/weebscreen-cert-renew` to `/etc/cron.monthly/weebscreen-cert-renew`
- `deploy/cron/weebscreen-cert-expiry-check` to `/etc/cron.daily/weebscreen-cert-expiry-check`

Then:

```sh
sudo chmod 755 /etc/cron.daily/weebscreen-backup
sudo chmod 755 /etc/cron.monthly/weebscreen-cert-renew
sudo chmod 755 /etc/cron.daily/weebscreen-cert-expiry-check
sudo /etc/cron.daily/weebscreen-backup
sudo /etc/cron.daily/weebscreen-cert-expiry-check
```

Confirm the backup lands under the `personal` dataset SMB mount, for example
`/mnt/personal/weebscreen-backup/`.

## Human-Read Required Before Deploy

- Upload parser/admin routes and `WEEBSCREEN_ADMIN_TOKEN` handling.
- `/etc/pve/firewall/202.fw`.
- Tailscale ACL diff for `tag:weebscreen`.
- Backup script destination, permissions, and alert behavior.

