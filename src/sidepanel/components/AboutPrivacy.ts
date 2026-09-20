const PRIVACY_POLICY_URL =
  "https://github.com/arthur422tp/LeetYourBrain2Code/blob/main/PRIVACY.md";

export interface AboutPrivacyHandle {
  element: HTMLDetailsElement;
}

export function createAboutPrivacy(): AboutPrivacyHandle {
  const element = document.createElement("details");
  element.className = "about-privacy";

  const summary = document.createElement("summary");
  summary.textContent = "About & privacy";

  const body = document.createElement("div");
  body.className = "about-privacy__body";

  const heading = document.createElement("p");
  heading.className = "about-privacy__heading";
  heading.textContent = "Runs locally";

  const disclosure = document.createElement("p");
  disclosure.className = "about-privacy__copy";
  disclosure.textContent =
    "This extension reads the Python code and testcase on the active LeetCode page to build the visualization. Execution uses bundled Pyodide in your browser. Your code and testcase are not sent to a backend.";

  const policy = document.createElement("p");
  policy.className = "about-privacy__policy";
  const policyLink = document.createElement("a");
  policyLink.href = PRIVACY_POLICY_URL;
  policyLink.target = "_blank";
  policyLink.rel = "noopener noreferrer";
  policyLink.textContent = "Privacy Policy";
  policy.append("Read the full ", policyLink, ".");

  body.append(heading, disclosure, policy);
  element.append(summary, body);
  return { element };
}
