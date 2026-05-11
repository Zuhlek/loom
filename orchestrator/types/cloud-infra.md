# cloud-infra Type

Accumulated guidance for cloud infrastructure projects (pipelines, scripts, registry/image management).

## File Creation

- **Check for existing files before creating.** Repos often have legacy scripts that need updating rather than fresh creation. Read the target path first.

## Registry & Image Scanning

- **Trivy private registry auth:** Use `TRIVY_USERNAME` / `TRIVY_PASSWORD` env vars for registry authentication. No Docker daemon or `docker login` needed — works in minimal CI environments like Bitbucket pipelines.

## Architecture Analysis Checklist

When analyzing infrastructure for changes (especially VNet, subnet, or resource group moves):
- **VPN/vWAN/peering dependencies:** Always check for VPN gateways, vWAN hubs, or peering connections that depend on the VNet. These are easy to miss and break connectivity if moved or deleted.
- **DNS dependencies:** Check for Private DNS Zones linked to VNets — these may self-heal on re-link but verify.
- **Cross-resource-group references:** Resources in one RG may reference resources in another (e.g., NICs referencing subnets). Map these before planning moves.
- **Verify before recommending removal:** Before recommending removing or changing existing infrastructure config, verify whether the current deployment works with it. Working infra > theoretically cleaner architecture.
- **Map pipeline reads vs writes:** During architecture design, explicitly list what each pipeline reads and writes. Default to runtime resolution (ARM deployment outputs) over parameter sharing between pipelines.

## Pipeline Design

- **Lifecycle alignment:** Persistent infrastructure (VNets, DNS zones, firewalls) gets its own pipeline with its own lifecycle. Ephemeral resources (VMs, containers, app deployments) share a pipeline. Don't mix persistent and ephemeral in the same pipeline.
- **Destroy safety:** Persistent resource pipelines should never have a default destroy path. Require explicit confirmation or separate destroy pipeline.

## Triage Bias

- Deep track projects: Explore broadly across ALL relevant repos during Analyze phase. Don't shortcut initial exploration.

## Architecture Mockups

- **Failure mode analysis (deep track):** Architecture mockups for deep track projects must include detailed failure mode analysis: what happens if each phase fails partway, rollback procedures, retry safety guarantees, and state corruption risks. Brief bullet points are insufficient for production infra.
