export const FEATURE_LOCK_EVENT = "ivs-feature-locked";

export type FeatureLockDetail = {
  title: string;
  description?: string;
};

export function showFeatureLocked(title: string, description?: string) {
  window.dispatchEvent(
    new CustomEvent<FeatureLockDetail>(FEATURE_LOCK_EVENT, {
      detail: { title, description },
    })
  );
}
