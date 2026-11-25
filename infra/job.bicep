// Tâche planifiée « maroubra-releve » : le relevé horaire du Track record pendant que l'app dort
// (option B choisie par Samuel le 26/11/2026, partie W du plan). Même image que l'app, commande `node job.mjs` :
// une passe sur les sources archivées, écriture de l'heure dans la table `archive`, puis arrêt.
// Sans secret : déployable seule dans le groupe du projet (docs/DEPLOY.md, « Changements ciblés »).
// Coût : environ 30 s par heure à 0,25 vCPU, dans la franchise mensuelle gratuite de Container Apps.
// Learn : https://learn.microsoft.com/azure/container-apps/jobs#scheduled-jobs
//         https://learn.microsoft.com/azure/container-apps/billing#jobs
param name string
param location string
param tags object
param containerImage string
param environmentId string
param registryServer string
param runIdentityName string
param ciIdentityName string
param storageName string

resource runIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2024-11-30' existing = {
  name: runIdentityName
}

resource ciIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2024-11-30' existing = {
  name: ciIdentityName
}

resource storage 'Microsoft.Storage/storageAccounts@2026-06-01' existing = {
  name: storageName
}

var containerAppsContributor = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '358470bc-b998-42bd-ab17-a7e34c199c0f')

resource job 'Microsoft.App/jobs@2026-07-01' = {
  name: '${name}-releve'
  location: location
  tags: tags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${runIdentity.id}': {}
    }
  }
  properties: {
    environmentId: environmentId
    workloadProfileName: 'Consumption'
    configuration: {
      triggerType: 'Schedule'
      // Chaque heure à la 5e minute (UTC) : les prévisions de l'heure sont publiées, l'heure reste la bonne
      // pour la clé d'archive (hourKey) quel que soit le fuseau.
      scheduleTriggerConfig: {
        cronExpression: '5 * * * *'
        parallelism: 1
        replicaCompletionCount: 1
      }
      replicaTimeout: 300
      replicaRetryLimit: 1
      registries: [
        {
          server: registryServer
          identity: runIdentity.id
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'releve'
          image: containerImage
          command: [
            'node'
            'job.mjs'
          ]
          resources: {
            cpu: json('0.25')
            memory: '0.5Gi'
          }
          env: [
            { name: 'AZURE_CLIENT_ID', value: runIdentity.properties.clientId }
            { name: 'TABLE_ENDPOINT', value: storage.properties.primaryEndpoints.table }
          ]
        }
      ]
    }
  }
}

// La CI met l'image de la tâche à jour à chaque déploiement, comme celle de l'app.
resource ciJobRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: job
  name: guid(job.id, 'id-${name}-ci', containerAppsContributor)
  properties: {
    roleDefinitionId: containerAppsContributor
    principalId: ciIdentity.properties.principalId
    principalType: 'ServicePrincipal'
    description: 'CI ${name} : mise à jour de la tâche de relevé'
  }
}
