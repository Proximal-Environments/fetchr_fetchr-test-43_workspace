# Fetchr Backend Database Snapshots

## Usage

### Create a snapshot:

```bash
npx tsx ../../create-snapshot.ts fetchr-prod-v1 \
  --from="postgresql://postgres.rrplvxkmolxehkwvjnri:98Yj1ixp09oTo42K@aws-0-us-west-1.pooler.supabase.com:5432/postgres" \
  --env=fetchr-backend
```

### Add to Dockerfile (one-time):

Add this line to `Dockerfile.rollout` before the main `COPY . /root/workspace/`:

```dockerfile
COPY snapshots/ /root/workspace/snapshots/
```

### Use in environment:

```typescript
const postgres = await container.install(
  PostgreSQL.forApp("fetchr").fromSnapshot("fetchr-prod-v1")
);
```

## Files

- `*.sql` - Database snapshots (schema-only)
- Each snapshot loads in ~3 seconds vs 30+ seconds for live cloning
