// Non-Docker deployment option: run the API under pm2 for auto-restart on crash and on
// server reboot. Usage on a VPS:
//   npm install -g pm2
//   cd server && npm ci --omit=dev
//   pm2 start ecosystem.config.cjs
//   pm2 save && pm2 startup   # restart pm2 (and this app) automatically on server reboot
module.exports = {
  apps: [
    {
      name: "nimiq-racer-server",
      script: "src/index.js",
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 2000,
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
