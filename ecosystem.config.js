module.exports = {
  apps: [
    {
      name: 'jv-backend-core',
      script: 'src/server.js',
      // Single instance is usually enough for free tiers (low memory/CPU)
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      env: {
        NODE_ENV: 'development'
      },
      env_production: {
        NODE_ENV: 'production'
      },
      // Graceful restarts and minimal memory footprint
      max_memory_restart: '512M',
      kill_timeout: 5000
    }
  ]
};


