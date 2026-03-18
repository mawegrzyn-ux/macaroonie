module.exports = {
  apps: [
    {
      name:         'macaroonie-api',
      script:       './api/src/server.js',
      instances:    'max',
      exec_mode:    'cluster',
      watch:        false,
      max_memory_restart: '512M',
      env_file:     './api/.env',
      error_file:   './logs/api-error.log',
      out_file:     './logs/api-out.log',
      merge_logs:   true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      exp_backoff_restart_delay: 100,
    }
  ]
}
