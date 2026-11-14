// One service as a Container App: Consumption plan, scales to zero, at most 1 replica.
param name string
param location string
param environmentId string
param image string

@secure()
param databaseUrl string

@description('Plain (non-secret) environment variables: [{ name, value }]')
param envVars array = []

param ghcrUsername string = ''
@secure()
param ghcrToken string = ''

var usePrivateRegistry = !empty(ghcrToken)

resource app 'Microsoft.App/containerApps@2024-03-01' = {
  name: name
  location: location
  properties: {
    managedEnvironmentId: environmentId
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: 8000
        transport: 'auto'
        allowInsecure: false
      }
      secrets: concat(
        [{ name: 'database-url', value: databaseUrl }],
        usePrivateRegistry ? [{ name: 'ghcr-token', value: ghcrToken }] : []
      )
      registries: usePrivateRegistry
        ? [{ server: 'ghcr.io', username: ghcrUsername, passwordSecretRef: 'ghcr-token' }]
        : []
    }
    template: {
      containers: [
        {
          name: 'app'
          image: image
          resources: { cpu: json('0.25'), memory: '0.5Gi' }
          env: concat([{ name: 'DATABASE_URL', secretRef: 'database-url' }], envVars)
        }
      ]
      scale: {
        minReplicas: 0
        maxReplicas: 1
        rules: [{ name: 'http', http: { metadata: { concurrentRequests: '20' } } }]
      }
    }
  }
}

output fqdn string = app.properties.configuration.ingress.fqdn
