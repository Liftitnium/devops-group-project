-- One service's own database user on Azure SQL, run by infra/setup.sh as the server admin
-- against that service's database (sqlcmd -d <db>). A contained user: it exists only in this
-- database, so the login cannot see or open the other service's database or master.
-- db_owner of its own database lets the service run its own migrations at startup.
-- Every statement is guarded, so re-running only re-applies the password.
-- sqlcmd fills $(APP_USER) and $(APP_PASSWORD) from the environment.
SET NOCOUNT ON;

DECLARE @sql NVARCHAR(MAX);
IF USER_ID(N'$(APP_USER)') IS NULL
    SET @sql = N'CREATE USER ' + QUOTENAME(N'$(APP_USER)')
             + N' WITH PASSWORD = ' + QUOTENAME(N'$(APP_PASSWORD)', N'''');
ELSE
    SET @sql = N'ALTER USER ' + QUOTENAME(N'$(APP_USER)')
             + N' WITH PASSWORD = ' + QUOTENAME(N'$(APP_PASSWORD)', N'''');
EXEC (@sql);

IF IS_ROLEMEMBER(N'db_owner', N'$(APP_USER)') = 0
BEGIN
    SET @sql = N'ALTER ROLE db_owner ADD MEMBER ' + QUOTENAME(N'$(APP_USER)');
    EXEC (@sql);
END;

PRINT 'app-user: $(APP_USER) is in place';
