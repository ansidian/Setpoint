let requestDrainAt = () => false;

export function registerEmailTriageDrainRequester(requester) {
  requestDrainAt = typeof requester === "function" ? requester : () => false;
}

export function requestEmailTriageDrainAt(scheduledFor) {
  return requestDrainAt(scheduledFor);
}
