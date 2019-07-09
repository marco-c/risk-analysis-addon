/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

'use strict';

function getRiskAnalysisURL(diffID, artifact) {
  return `https://index.taskcluster.net/v1/task/project.relman.bugbug.classify_patch.diff.${diffID}/artifacts/public/${artifact}`;
}

async function getRiskAnalysisResult(diffID) {
  const response = await fetch(getRiskAnalysisURL(diffID, "probs,json"));
  if (!response.ok) {
    throw new Error("Error fetching risk analysis results for this diff.");
  }
  return await response.json();
}

const diffIDPattern = RegExp(/Diff (\d+)/);

async function inject() {
  let diffID = null;
  let diffDetail = null;

  const headers = document.querySelectorAll("span.phui-header-header");
  for (const header of headers) {
    if (header.textContent == "Diff Detail") {
      diffDetail = header;
      continue;
    }

    const result = header.textContent.match(diffIDPattern);
    if (!result) {
      continue;
    }

    diffID = result[1];
  }

  if (!diffID) {
    throw new Error("Missing diff ID");
  }

  if (!diffDetail) {
    throw new Error("Missing diff detail box");
  }

  const diffDetailBox = diffDetail.parentElement.parentElement.parentElement.parentElement.parentElement;

  const riskAnalysisResult = await getRiskAnalysisResult(diffID);

  const nonRiskyProb = riskAnalysisResult[0];
  const riskyProb = riskAnalysisResult[1];
  const riskyText = riskyProb > nonRiskyProb ? "Risky" : "Not risky"
  const confidence = Math.round(100 * (riskyProb > nonRiskyProb ? riskyProb : nonRiskyProb));

  let riskAnalysisBox = diffDetailBox.cloneNode(true);

  let riskAnalysisTitle = riskAnalysisBox.querySelector("span.phui-header-header");
  riskAnalysisTitle.textContent = `Diff Risk Analysis - ${riskyText} with ${confidence}% confidence`;

  let riskAnalysisContent = riskAnalysisBox.querySelector('div[data-sigil=phui-tab-group-view]');

  let riskAnalysisFrame = document.createElement("iframe");
  riskAnalysisFrame.src = getRiskAnalysisURL(diffID, "importance.html");
  riskAnalysisFrame.width = "100%";

  riskAnalysisContent.firstChild.replaceWith(riskAnalysisFrame);

  diffDetailBox.parentNode.insertBefore(riskAnalysisBox, diffDetailBox.nextSibling);
}

inject();
