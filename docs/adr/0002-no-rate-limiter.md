# 0002: Bound sends with workpool

Workpool parallelism is fixed at 10. The component has no proactive rate limiter because no provider send quota is available to configure it. Classify HTTP 429 and honor bounded `Retry-After` delays.
