// Builds the CMS Docker image and deploys it to a server over SSH.
// The persistent volume (user sites + SQLite) is never touched by a deploy.
//
// Jenkins credentials used:
//   - 'cms-ssh-key'      : SSH private key for the deploy host (SSH Username with private key)
//   - 'cms-registry'     : username/password for your container registry (optional)
// Set REGISTRY / DEPLOY_HOST / DEPLOY_DIR below for your environment.

pipeline {
  agent any

  environment {
    REGISTRY    = 'registry.example.com/landing-cms'
    DEPLOY_HOST = 'deploy@your-server-ip'
    DEPLOY_DIR  = '/srv/cms'              // holds docker-compose.yml, Caddyfile, .env on the server
    IMAGE       = "${REGISTRY}:${BUILD_NUMBER}"
  }

  stages {
    stage('Checkout') {
      steps { checkout scm }
    }

    stage('Build image') {
      steps {
        sh 'docker build -t $IMAGE -t $REGISTRY:latest .'
      }
    }

    stage('Push image') {
      steps {
        withCredentials([usernamePassword(credentialsId: 'cms-registry', usernameVariable: 'U', passwordVariable: 'P')]) {
          sh 'echo "$P" | docker login $REGISTRY --username "$U" --password-stdin'
          sh 'docker push $IMAGE'
          sh 'docker push $REGISTRY:latest'
        }
      }
    }

    stage('Deploy') {
      steps {
        sshagent(['cms-ssh-key']) {
          // Pull the new image and restart only the cms service; the cms-data volume persists.
          sh """
            ssh -o StrictHostKeyChecking=accept-new $DEPLOY_HOST '
              cd $DEPLOY_DIR &&
              export CMS_IMAGE=$IMAGE &&
              docker compose pull cms &&
              docker compose up -d
            '
          """
        }
      }
    }
  }

  post {
    success { echo "Deployed $IMAGE" }
    failure { echo 'Deploy failed — the previous container keeps running.' }
  }
}
