# user-d15c0rd
A discord bot that allows you to upload an image with audio and a title to Youtube and Soundcloud

# Installation
```
git clone https://github.com/Latex4000/user-d15c0rd.git
cd user-d15c0rd
npm ci
```

# Configuration
Create a `config.json` file in the root directory and copypaste from `config.json.example` and fill in the values.

# Development
```
npm run dev
```

To delete the commands generated during development, run:
```
npm run delete
```

## HTTP-only development
Set `discord.enable` to `false` in `config.json` and start the dev server as usual

slash-command reg and discord login is skipped but local HTTP server will still boot basically so the [website](https://github.com/Latex4000/website) can still submit test payloads at http://localhost:<configured_http_port> (whatever you set in `config.http.port`).

# Usage
```
npm run build
npm run start
```