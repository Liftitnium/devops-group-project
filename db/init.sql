-- One database and one login per service. Run as sa by the one-off db-init container
-- (docker compose) on every `up`, so every statement is guarded: running it again
-- changes nothing, except re-applying the passwords from .env.
-- sqlcmd fills $(WORKOUTS_DB_PASSWORD) and $(PROGRESS_DB_PASSWORD) from the environment.
-- Tables are not created here: each service applies its own migrations at startup.
SET NOCOUNT ON;

IF DB_ID(N'liftlog_workouts') IS NULL CREATE DATABASE liftlog_workouts;
IF DB_ID(N'liftlog_progress') IS NULL CREATE DATABASE liftlog_progress;
GO

-- readers never wait for writers.
-- Only switched once: the ALTER needs the database to itself.
IF EXISTS (SELECT 1 FROM sys.databases WHERE name = N'liftlog_workouts' AND is_read_committed_snapshot_on = 0)
    ALTER DATABASE liftlog_workouts SET READ_COMMITTED_SNAPSHOT ON WITH ROLLBACK IMMEDIATE;
IF EXISTS (SELECT 1 FROM sys.databases WHERE name = N'liftlog_progress' AND is_read_committed_snapshot_on = 0)
    ALTER DATABASE liftlog_progress SET READ_COMMITTED_SNAPSHOT ON WITH ROLLBACK IMMEDIATE;
GO

-- logins: created once, password re-applied on every run so .env stays the source of truth
DECLARE @sql NVARCHAR(MAX);

IF SUSER_ID(N'workouts_app') IS NULL
    SET @sql = N'CREATE LOGIN workouts_app WITH PASSWORD = ' + QUOTENAME(N'$(WORKOUTS_DB_PASSWORD)', N'''')
             + N', DEFAULT_DATABASE = liftlog_workouts';
ELSE
    SET @sql = N'ALTER LOGIN workouts_app WITH PASSWORD = ' + QUOTENAME(N'$(WORKOUTS_DB_PASSWORD)', N'''');
EXEC (@sql);

IF SUSER_ID(N'progress_app') IS NULL
    SET @sql = N'CREATE LOGIN progress_app WITH PASSWORD = ' + QUOTENAME(N'$(PROGRESS_DB_PASSWORD)', N'''')
             + N', DEFAULT_DATABASE = liftlog_progress';
ELSE
    SET @sql = N'ALTER LOGIN progress_app WITH PASSWORD = ' + QUOTENAME(N'$(PROGRESS_DB_PASSWORD)', N'''');
EXEC (@sql);
GO

-- each login is a user in its own database only. db_owner there lets the service run
-- its own migrations; it has no user at all in the other service's database.
USE liftlog_workouts;
IF USER_ID(N'workouts_app') IS NULL CREATE USER workouts_app FOR LOGIN workouts_app;
IF IS_ROLEMEMBER(N'db_owner', N'workouts_app') = 0 ALTER ROLE db_owner ADD MEMBER workouts_app;
GO

USE liftlog_progress;
IF USER_ID(N'progress_app') IS NULL CREATE USER progress_app FOR LOGIN progress_app;
IF IS_ROLEMEMBER(N'db_owner', N'progress_app') = 0 ALTER ROLE db_owner ADD MEMBER progress_app;
GO

PRINT 'db-init: databases and logins are in place';
