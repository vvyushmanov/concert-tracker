# Running the stack on a shared Mac (non-admin user)

The stack runs in a Colima VM owned by an unprivileged user (`claw-vadim`).
Everything lives in that user's home; one admin step installs the boot service.

## One-time setup (as the stack user, no admin)

```bash
git clone https://github.com/vvyushmanov/concert-tracker.git ~/concert-tracker
colima start --vm-type vz --arch aarch64 --cpu 2 --memory 1 --disk 10 \
  --mount "$HOME/concert-tracker:w" --runtime docker
# put .env in ~/concert-tracker (chmod 600), then:
cd ~/concert-tracker && ./deploy.sh
```

- `--memory` is a cap, allocated lazily, but it is also the real long-run cost on
  the Mac: a Virtualization.framework VM never hands touched memory back (lima's
  balloon device is attached but not driven), so the footprint settles at the cap
  and stays there until the VM restarts. Measured at 1 GiB: ~1.0 GB footprint,
  ~350 MB in use inside the guest (the stack peaks around 370 MB).
- Only the project directory is mounted into the VM (Colima's default would
  mount the whole home directory writable).
- `--disk` is a cap on a sparse file; real use is ~2–4 GB.

## Boot service (admin, once)

`com.concert-tracker.colima.plist` runs `colima-watchdog.sh` **as `claw-vadim`,
not root**, at boot and then every 5 minutes. A healthy VM is left alone; a
stopped or wedged one is restarted. Log: `~/Library/Logs/concert-tracker-watchdog.log`
of the stack user.

```bash
sudo cp /Users/claw-vadim/concert-tracker/deploy/macos/com.concert-tracker.colima.plist /Library/LaunchDaemons/
sudo chown root:wheel /Library/LaunchDaemons/com.concert-tracker.colima.plist
sudo chmod 644 /Library/LaunchDaemons/com.concert-tracker.colima.plist
sudo launchctl bootstrap system /Library/LaunchDaemons/com.concert-tracker.colima.plist
```

Pausing it for maintenance (no admin): `touch ~/.concert-tracker-pause`, and
`rm` it when done.

Remove: `sudo launchctl bootout system/com.concert-tracker.colima && sudo rm /Library/LaunchDaemons/com.concert-tracker.colima.plist`

With FileVault on, nothing starts after a reboot until the disk is unlocked at
the login window.
