# First-launch issues

1. NPM packets can't be installed without root permissions
2. No default admin user created
3. Extra USER-parameters created when launching the Scan for the first time: LAST_FM_API_KEY
4. Extra global parameters created when launching the Scan for the first time: LASTFM USER, MIN PLAYCOUNT
5. Country codes are added to database as an array - they need to be converted to database values (like Global Add Country does) and NOT saved as string array
6. Need to pin Python version to 3.12 in Dockerfile.dev and Dockerfile.prod