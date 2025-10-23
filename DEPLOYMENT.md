# Heroku Deployment Guide (Docker)

This guide will walk you through deploying your reportRunner app to Heroku using Docker.

## Prerequisites Checklist

Before starting, ensure you have:
- [ ] Heroku CLI installed ([Download here](https://devcenter.heroku.com/articles/heroku-cli))
- [ ] Docker Desktop installed and running ([Download here](https://www.docker.com/products/docker-desktop/))
- [ ] A Heroku account ([Sign up here](https://signup.heroku.com/))
- [ ] Git installed and configured

## Step-by-Step Deployment Instructions

### 1. Login to Heroku

Open your terminal (PowerShell) and run:
```bash
heroku login
```
This will open your browser to authenticate.

### 2. Create a New Heroku App

```bash
heroku create reportrunner
```
> Note: Replace `reportrunner` with your preferred app name, or omit it to let Heroku generate a random name.

This command will output your app URL, something like: `https://reportrunner-xxxxx.herokuapp.com`

### 3. Set Heroku Stack to Container

```bash
heroku stack:set container
```

### 4. Configure Environment Variables

Set all required environment variables on Heroku:

```bash
heroku config:set NOTION_API_KEY="your_notion_api_key_here"
heroku config:set NOTION_CLIENTS_DB_ID="your_notion_clients_db_id_here"
heroku config:set NOTION_MONTHLY_RECAPS_PARENT_PAGE_ID="your_monthly_recaps_parent_page_id_here"
heroku config:set ANTHROPIC_API_KEY="your_anthropic_api_key_here"
heroku config:set NODE_ENV="production"
```

**Important:** Update these values with your actual production API keys if they're different!

### 5. Commit All Changes

```bash
git add .
git commit -m "Add Heroku deployment configuration"
```

### 6. Deploy to Heroku

Since you're currently on the `feature/complete-codebase` branch, push it to Heroku's main branch:

```bash
git push heroku feature/complete-codebase:main
```

This will:
- Upload your code to Heroku
- Build the Docker image
- Deploy your application

The build process takes 3-5 minutes on first deploy.

### 7. Verify Deployment

Once deployment completes, open your app:
```bash
heroku open
```

Or visit the URL shown in the terminal.

### 8. Monitor Your Application

To view live logs:
```bash
heroku logs --tail
```

To check dyno status:
```bash
heroku ps
```

## Troubleshooting

### Build Fails
```bash
heroku logs --tail
```
Check the logs for specific error messages.

### App Crashes on Startup
```bash
heroku logs --tail
```
Usually caused by missing environment variables or build issues.

### Environment Variables Not Working
List all config vars:
```bash
heroku config
```

### Need to Restart the App
```bash
heroku restart
```

## Updating Your App

After making code changes:
```bash
git add .
git commit -m "Your commit message"
git push heroku feature/complete-codebase:main
```

## Scaling

To scale your web dyno:
```bash
heroku ps:scale web=1
```

## Cost Considerations

- Heroku no longer offers a free tier
- Minimum cost: Eco dyno (~$5/month)
- Your app will sleep after 30 minutes of inactivity on Eco plan
- Consider Basic dyno ($7/month) for production use with no sleep

## Useful Commands

| Command | Purpose |
|---------|---------|
| `heroku apps` | List all your apps |
| `heroku logs --tail` | View live logs |
| `heroku restart` | Restart the app |
| `heroku ps` | Check dyno status |
| `heroku config` | View environment variables |
| `heroku config:set KEY=value` | Set environment variable |
| `heroku config:unset KEY` | Remove environment variable |
| `heroku open` | Open app in browser |
| `heroku releases` | View deployment history |
| `heroku rollback` | Rollback to previous version |

## Next Steps After Deployment

1. Test all functionality in production
2. Set up a custom domain (if needed)
3. Enable metrics and monitoring
4. Set up error tracking (e.g., Sentry)
5. Configure database backups (if you add a database later)

## Support

- Heroku Documentation: https://devcenter.heroku.com/
- Heroku Dev Center: https://devcenter.heroku.com/categories/reference

