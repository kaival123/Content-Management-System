// Deploys the Landing CMS (a full-stack Node + Angular app, NOT a static site).
//
// Model: build-on-server, no registry. Jenkins SSHes to your server, updates the
// code, and rebuilds/restarts the Docker stack. The cms-data volume (SQLite + every
// user's website files) is never touched, so data survives every deploy.
//
// One-time server setup (done once, by hand):
//   1. Install Docker + the compose plugin.
//   2. git clone <this repo> into DEPLOY_DIR (e.g. /srv/cms).
//   3. cd DEPLOY_DIR && cp .env.example .env   and fill it in.
//   4. Edit Caddyfile with your domain; point the domain's DNS at this server.
//
// Jenkins setup:
//   - Add an SSH key credential with id 'cms-ssh-key' that can log into DEPLOY_HOST.
//   - Set DEPLOY_HOST / DEPLOY_DIR / APP_URL below.

pipeline {
  agent any

  environment {
    DEPLOY_HOST = 'deploy@your-server-ip'   // SSH target for your server
    DEPLOY_DIR  = '/srv/cms'                 // git clone of this repo on the server
    BRANCH      = 'main'
    APP_URL     = 'https://app.yourdomain.com'  // used only for the post-deploy health check
  }

  options {
    timestamps()
    disableConcurrentBuilds()   // never run two deploys at once
  }

  stages {
    stage('Deploy') {
      steps {
        sshagent(['cms-ssh-key']) {
          sh '''
            ssh -o StrictHostKeyChecking=accept-new $DEPLOY_HOST bash -se <<EOF
              set -euo pipefail
              cd "$DEPLOY_DIR"

              echo "==> Updating code"
              git fetch --prune origin
              git checkout "$BRANCH"
              git reset --hard "origin/$BRANCH"

              echo "==> Rebuilding and restarting (data volume is preserved)"
              docker compose up -d --build

              echo "==> Cleaning up old images"
              docker image prune -f
EOF
          '''
        }
      }
    }

    stage('Health check') {
      steps {
        sshagent(['cms-ssh-key']) {
          // /api/auth/me needs no session; a 200 means the server is up and serving.
          sh '''
            ssh -o StrictHostKeyChecking=accept-new $DEPLOY_HOST bash -se <<EOF
              set -e
              for i in \\$(seq 1 20); do
                code=\\$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$APP_URL/api/auth/me" || true)
                if [ "\\$code" = "200" ]; then echo "Healthy (200)"; exit 0; fi
                echo "waiting... (\\$code)"; sleep 3
              done
              echo "Health check failed"; exit 1
EOF
          '''
        }
      }
    }
  }

  post {
    success { echo 'Deployed. Data volume preserved.' }
    failure { echo 'Deploy failed — the previous container keeps running.' }
  }
}
