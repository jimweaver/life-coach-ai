# Life Coach AI - Kubernetes Deployment

Production-ready Kubernetes manifests for deploying Life Coach AI.

## Prerequisites

- Kubernetes 1.24+
- kubectl configured
- Optional: cert-manager for TLS
- Optional: nginx-ingress for ingress

## Quick Start

```bash
# 1. Create namespace and apply all manifests
kubectl apply -f config/kubernetes/

# 2. Or apply step by step
kubectl apply -f config/kubernetes/00-namespace.yml
kubectl apply -f config/kubernetes/01-configmap.yml
kubectl apply -f config/kubernetes/03-postgres.yml
kubectl apply -f config/kubernetes/04-redis.yml
kubectl apply -f config/kubernetes/05-api.yml
kubectl apply -f config/kubernetes/06-hpa.yml
kubectl apply -f config/kubernetes/07-pdb.yml
```

## Configuration

### 1. Update Secrets

Edit `02-secrets.yml` or create secrets via kubectl:

```bash
kubectl create secret generic life-coach-secrets \
  --from-literal=DATABASE_URL="postgresql://lifecoach:password@life-coach-postgres:5432/life_coach" \
  --from-literal=OPENAI_API_KEY="sk-your-key-here" \
  --from-literal=BRAVE_API_KEY="your-key-here" \
  -n life-coach
```

### 2. Update ConfigMap (Optional)

Edit `01-configmap.yml` to customize:
- Timezone settings
- Scheduler intervals
- Alert routing strategy

### 3. Update Ingress

Edit `05-api.yml` Ingress section:
- Replace `api.life-coach.example.com` with your domain
- Configure TLS certificate

## Architecture

```
┌─────────────────┐
│   Ingress       │
│  (nginx)        │
└────────┬────────┘
         │
┌────────▼────────┐
│   API Service   │◄───┐
│  (2+ replicas)  │    │ HPA
└────────┬────────┘    │
         │             │
    ┌────┴────┐        │
    │         │        │
┌───▼───┐ ┌───▼───┐    │
│  Pod  │ │  Pod  │────┘
└───┬───┘ └───────┘
    │
    ├──────► PostgreSQL (StatefulSet)
    └──────► Redis (Deployment)
```

## Components

| File | Purpose |
|------|---------|
| `00-namespace.yml` | Dedicated namespace for isolation |
| `01-configmap.yml` | Non-sensitive configuration |
| `02-secrets.yml` | Sensitive data (API keys, DB URLs) |
| `03-postgres.yml` | PostgreSQL 16 StatefulSet with PVC |
| `04-redis.yml` | Redis 7 Deployment |
| `05-api.yml` | API Deployment, Service, Ingress |
| `06-hpa.yml` | Horizontal Pod Autoscaler (2-10 pods) |
| `07-pdb.yml` | Pod Disruption Budget for HA |
| `08-network-policy.yml` | Network security rules |

## Resource Limits

| Component | CPU Request | CPU Limit | Memory Request | Memory Limit |
|-----------|-------------|-----------|----------------|--------------|
| API | 250m | 500m | 256Mi | 512Mi |
| PostgreSQL | 250m | 500m | 256Mi | 512Mi |
| Redis | 100m | 200m | 128Mi | 256Mi |

## Scaling

### Manual Scaling
```bash
kubectl scale deployment life-coach-api --replicas=5 -n life-coach
```

### Auto-scaling (HPA)
- Min replicas: 2
- Max replicas: 10
- Scale up at 70% CPU or 80% memory
- Scale down after 5 minutes stabilization

## Monitoring

### Check Pod Status
```bash
kubectl get pods -n life-coach
kubectl logs -f deployment/life-coach-api -n life-coach
```

### Check Services
```bash
kubectl get svc -n life-coach
kubectl get ingress -n life-coach
```

### Check HPA
```bash
kubectl get hpa -n life-coach
```

## Updates

### Rolling Update
```bash
kubectl set image deployment/life-coach-api api=jimweaver/life-coach-ai:v1.1.0 -n life-coach
```

### Monitor Rollout
```bash
kubectl rollout status deployment/life-coach-api -n life-coach
```

### Rollback
```bash
kubectl rollout undo deployment/life-coach-api -n life-coach
```

## Cleanup

```bash
# Delete all resources
kubectl delete -f config/kubernetes/

# Delete namespace and all contained resources
kubectl delete namespace life-coach
```

## Production Checklist

- [ ] Update secrets with real values
- [ ] Configure proper domain in Ingress
- [ ] Set up TLS certificates (cert-manager)
- [ ] Configure monitoring (Prometheus/Grafana)
- [ ] Set up log aggregation
- [ ] Configure backup for PostgreSQL
- [ ] Review resource limits based on load
- [ ] Test rolling updates
- [ ] Document runbook procedures

## Troubleshooting

### Pods not starting
```bash
kubectl describe pod -n life-coach
kubectl logs -n life-coach [pod-name]
```

### Database connection issues
```bash
kubectl exec -it deployment/life-coach-api -n life-coach -- nc -zv life-coach-postgres 5432
```

### High memory usage
Check HPA status and consider increasing limits or optimizing application.
