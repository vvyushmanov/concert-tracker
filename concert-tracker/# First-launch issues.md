# First-launch issues

1. NPM packets can't be installed without root permissions
2. No default admin user created
3. User countries can't be added and there are no logs from the script in the container logs
4. Extra USER-parameters created when launching the Scan for the first time: LAST_FM_API_KEY
5. Extra global parameters created when launching the Scan for the first time: LASTFM USER, MIN PLAYCOUNT
6. Country codes are added to database as an array - they need to be converted to database values (like Global Add Country does) and NOT saved as string array
7. Global "Add Country" shows console error Failed to parse Python script output
8. Weird None output:

```shell
web-1  | 🐍 Concert Parser [User 1]: INFO [parse_concerts]: Metadata fetch completed
web-1  | 🐍 Concert Parser [User 1]: INFO [parse_concerts]: Database output: None
```

9. Need to pin Python version to 3.12 in Dockerfile.dev and Dockerfile.prod