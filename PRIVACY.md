# Privacy Policy — multi-google-mcp

_Last updated: 2026-10-25_

multi-google-mcp is an open-source, **self-hosted** command-line tool. It runs
entirely on the computer of the person who installs it. There is no hosted
service, no server operated by the author, and no telemetry.

## What data the software accesses
When you authorize it, the software accesses the Gmail, Google Calendar and
Google Drive data of the Google accounts **you** choose, through Google's
official APIs, using an OAuth client that **you** create in your own Google
Cloud project.

## Where data goes
- API responses are returned only to the MCP client you connected (for example
  Claude Code) on the same machine, in the course of the commands you issue.
- OAuth refresh tokens are stored on your local disk (`~/.google-mcp/`) with
  owner-only file permissions. They are never transmitted anywhere except to
  Google's token endpoint.
- The author of this software receives **no** data of any kind.

## Google API Services User Data Policy
Use of information received from Google APIs adheres to the
[Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy),
including the Limited Use requirements. The software does not transfer, sell,
or use Google user data for advertising, and does not allow humans to read it
except as directed by the user operating the tool.

## Revoking access
Remove the app at <https://myaccount.google.com/permissions> and delete the
token files under `~/.google-mcp/`.

## Contact
Open an issue on the GitHub repository.
