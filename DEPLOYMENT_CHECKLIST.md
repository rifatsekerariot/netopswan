# NetOpsWan Production Deployment Checklist

## Pre-Deployment Security Verification

### ✅ Code Changes Completed
- [x] Authentication middleware added to all API routes
- [x] Password hashing upgraded (SHA-256 → PBKDF2/bcrypt)
- [x] API response format standardized
- [x] SQL injection vulnerabilities fixed
- [x] Input validation added to all endpoints
- [x] Environment variables properly configured
- [x] Cookie security settings fixed
- [x] Frontend connected to real backend APIs
- [x] SSL/TLS validation enabled
- [x] Error handling standardized

### 🔧 Installation Steps

```bash
# 1. Install additional dependencies (on deployment server)
cd /opt/netoswan/dashboard/frontend
npm install bcryptjs pg ts-node dotenv

# 2. Build production bundle
npm run build

# 3. Update environment variables
cp .env.production .env.local
# Edit .env.local and set actual values:
#  - SDWAN_HUB_URL (must point to running Rust hub)
#  - DATABASE_URL (PostgreSQL credentials)
#  - ADMIN_PASSWORD (strong password)
#  - JWT_SECRET and ENCRYPTION_KEY

# 4. Verify database migrations are current
# Ensure netops_users table has:
#  - id (varchar primary key)
#  - username (varchar unique)
#  - email (varchar)
#  - password_hash (varchar)
#  - role (varchar)
#  - created_at (timestamp)
#  - updated_at (timestamp)

# 5. Run database initialization
npm run db:init  # If script exists

# 6. Test backend connectivity
curl -X GET https://localhost:3000/api/users \
  -H "Cookie: netopswan_token=test-token" \
  -k  # Skip SSL verification for self-signed cert

# 7. Restart backend service
systemctl restart sdwan-backend
# or
docker-compose restart netopswan-panel
```

### 🔐 Production Security Requirements

**Before deploying to production, verify:**

1. **Environment Variables Set:**
   ```bash
   export NODE_ENV=production
   export SDWAN_HUB_URL=http://sdwan-hub:8088
   export DATABASE_URL=postgresql://user:password@host:5432/netopswan
   export ADMIN_PASSWORD=$(openssl rand -base64 32)
   export JWT_SECRET=$(openssl rand -base64 64)
   export OPENWISP_INTERNAL_IP=<actual-ip>
   ```

2. **SSL/TLS Certificates:**
   - [ ] Generate/install valid SSL certificates
   - [ ] Set `NODE_TLS_REJECT_UNAUTHORIZED=1`
   - [ ] Configure HTTPS for all endpoints

3. **Database Security:**
   - [ ] Change default PostgreSQL password
   - [ ] Restrict database access to backend only
   - [ ] Enable SSL connection to database
   - [ ] Set up automated backups

4. **Rust Hub Integration:**
   - [ ] Verify Rust Hub service is running
   - [ ] Test connectivity from backend to hub
   - [ ] Monitor hub logs for errors
   - [ ] Set up circuit breaker for hub failures

5. **Monitoring & Logging:**
   - [ ] Enable application logging
   - [ ] Set up log rotation
   - [ ] Configure alerting for errors
   - [ ] Monitor CPU/memory/disk usage
   - [ ] Set up request tracing (optional: Sentry)

6. **Access Control:**
   - [ ] Update default admin password
   - [ ] Create non-root service account
   - [ ] Restrict SSH access
   - [ ] Enable firewall rules

### 📋 Post-Deployment Testing

1. **Authentication:**
   ```bash
   # Test login
   curl -X POST https://sdwan.ariot.com.tr/api/auth/login \
     -H "Content-Type: application/json" \
     -d '{"username":"admin","password":"your-password"}' \
     -k

   # Verify cookie is set
   curl -X GET https://sdwan.ariot.com.tr/api/users -k
   ```

2. **API Endpoints:**
   - [ ] GET /api/users (with auth)
   - [ ] POST /api/users (with auth)
   - [ ] GET /api/devices (with auth)
   - [ ] POST /api/devices (with auth)
   - [ ] GET /api/groups (with auth)

3. **Security Headers:**
   - [ ] Check HTTPS enforced
   - [ ] Verify CSRF protection
   - [ ] Confirm Content-Security-Policy set
   - [ ] Validate cookie flags (secure, httpOnly, sameSite)

4. **Error Handling:**
   - [ ] Test with invalid credentials
   - [ ] Test rate limiting (5+ failed logins)
   - [ ] Test with missing required fields
   - [ ] Verify error messages don't leak sensitive info

5. **Frontend Integration:**
   - [ ] Login form submits and receives token
   - [ ] User list loads from API
   - [ ] Device management works
   - [ ] Logout clears session

### 🐛 Rollback Procedure

If issues occur:

```bash
# 1. Revert to previous version
cd /opt/netoswan/dashboard/frontend
git revert HEAD

# 2. Rebuild
npm run build

# 3. Restart service
systemctl restart sdwan-backend

# 4. Clear cache
redis-cli FLUSHALL  # if using Redis
```

### 📞 Support

If encountering issues:

1. Check logs: `journalctl -u sdwan-backend -f`
2. Test Rust Hub: `curl http://sdwan-hub:8088/api/v1/sdwan/peers`
3. Check database: `psql -U netopswan -d netopswan -c "SELECT * FROM netops_users;"`
4. Verify network: `netstat -tlpn | grep 8088`

---

**Deployment Date:** ________  
**Deployed By:** ________  
**Verification:** ________  
