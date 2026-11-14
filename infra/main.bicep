// Every Azure resource of the group, in the group's existing resource group.
// Deploy with infra/setup.sh (it fills the parameters); never change these resources by
// hand afterwards. Counts stay within the brief: 2 Container Apps, 2 serverless SQL
// databases, 1 Static Web App. The SQL server, the Container Apps environment and its
// Log Analytics workspace are what those need to exist.
targetScope = 'resourceGroup'

@description('Group prefix, sdd-<class>-g<N>, e.g. sdd-3a-g6')
param prefix string

param location string = resourceGroup().location

@description('Static Web Apps exist in a few regions only')
param uiLocation string = 'westeurope'

param sqlAdminLogin string = 'liftlog_admin'

@secure()
param sqlAdminPassword string

@description('Full image references, e.g. ghcr.io/liftitnium/liftlog-workouts:<sha>')
param workoutsImage string
param progressImage string

@description('Only for private GHCR packages: a GitHub user and a token with read:packages')
param ghcrUsername string = ''
@secure()
param ghcrToken string = ''

resource logs 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: '${prefix}-logs'
  location: location
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
    // hard ceiling on ingestion cost; INFO logs of a demo app are far below it
    workspaceCapping: { dailyQuotaGb: json('0.5') }
  }
}

resource env 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: '${prefix}-env'
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logs.properties.customerId
        sharedKey: logs.listKeys().primarySharedKey
      }
    }
  }
}

resource sql 'Microsoft.Sql/servers@2023-08-01-preview' = {
  name: '${prefix}-sql'
  location: location
  properties: {
    administratorLogin: sqlAdminLogin
    administratorLoginPassword: sqlAdminPassword
    minimalTlsVersion: '1.2'
    publicNetworkAccess: 'Enabled'
  }
}

// 0.0.0.0 - 0.0.0.0 is Azure's "allow Azure services" rule: Container Apps can connect,
// the internet cannot. CI never connects (it uses its own SQL Server container).
resource allowAzure 'Microsoft.Sql/servers/firewallRules@2023-08-01-preview' = {
  parent: sql
  name: 'AllowAzureServices'
  properties: { startIpAddress: '0.0.0.0', endIpAddress: '0.0.0.0' }
}

var services = ['workouts', 'progress']

// serverless General Purpose, smallest size, pauses after 1 h idle
resource dbs 'Microsoft.Sql/servers/databases@2023-08-01-preview' = [for svc in services: {
  parent: sql
  name: '${prefix}-${svc}-db'
  location: location
  sku: { name: 'GP_S_Gen5', tier: 'GeneralPurpose', family: 'Gen5', capacity: 1 }
  properties: {
    autoPauseDelay: 60
    minCapacity: json('0.5')
    maxSizeBytes: 2147483648
    requestedBackupStorageRedundancy: 'Local'
    zoneRedundant: false
  }
}]

resource ui 'Microsoft.Web/staticSites@2023-12-01' = {
  name: '${prefix}-ui'
  location: uiLocation
  sku: { name: 'Free', tier: 'Free' }
  properties: {}
}

var uiOrigin = 'https://${ui.properties.defaultHostname}'

func dbUrl(login string, password string, host string, db string) string =>
  'mssql://${login}:${uriComponent(password)}@${host}:1433/${db}'

module workouts 'containerapp.bicep' = {
  name: 'workouts-app'
  dependsOn: [dbs, allowAzure]
  params: {
    name: '${prefix}-workouts'
    location: location
    environmentId: env.id
    image: workoutsImage
    databaseUrl: dbUrl(sqlAdminLogin, sqlAdminPassword, sql.properties.fullyQualifiedDomainName, '${prefix}-workouts-db')
    envVars: [
      { name: 'ALLOWED_ORIGINS', value: uiOrigin }
    ]
    ghcrUsername: ghcrUsername
    ghcrToken: ghcrToken
  }
}

module progress 'containerapp.bicep' = {
  name: 'progress-app'
  dependsOn: [dbs, allowAzure]
  params: {
    name: '${prefix}-progress'
    location: location
    environmentId: env.id
    image: progressImage
    databaseUrl: dbUrl(sqlAdminLogin, sqlAdminPassword, sql.properties.fullyQualifiedDomainName, '${prefix}-progress-db')
    envVars: [
      { name: 'ALLOWED_ORIGINS', value: uiOrigin }
      { name: 'WORKOUTS_URL', value: 'https://${workouts.outputs.fqdn}' }
      { name: 'WORKOUTS_TIMEOUT_S', value: '3' }
    ]
    ghcrUsername: ghcrUsername
    ghcrToken: ghcrToken
  }
}

output uiUrl string = uiOrigin
output workoutsUrl string = 'https://${workouts.outputs.fqdn}'
output progressUrl string = 'https://${progress.outputs.fqdn}'
output logAnalyticsWorkspace string = logs.name
