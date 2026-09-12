export async function register() {
  // Standalone appliance runtime instrumentation
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startDeviceSyncScheduler } = await import('@/lib/device-sync-scheduler');
    startDeviceSyncScheduler();
  }
}

