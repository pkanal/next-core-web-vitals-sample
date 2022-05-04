import axios from 'axios';
import {getCLS, getFID, getLCP, getTTFB} from 'web-vitals';

// Threshold to weed out insignificant Layout Shift events
const CLS_THRESHOLD = .02;
// Simple generic session ID that will help us query all events on a given session
const sessionID =  '_' + Math.random().toString(36).substr(2, 9);

let metadata = {};

// This method is called on initial load and lets us capture all metadata
// about the browser and device that might help us dig into patterns
function captureMetadata() {
  metadata = {
    pathname: document.location.pathname, 
    // Pixel dimensions of the visible screen
    screenWidth: window.innerWidth,
    screenHeight: window.innerHeight,
    // Browser string
    browser: navigator.userAgent,
    // Platform info reported by browser
    platform: navigator.userAgentData.platform || null ,
    // Browser vendor
    vendor: navigator.userAgentData.vendor || null,
    sessionID
  }
}

// Grab the url of every script on the page and determine if the script
// is loaded asynchronously and deferred
function captureScriptData() {
  const inlineCounter = 0;
  const data = {}
  Array.prototype.forEach.call(document.scripts, (script) =>{
    let filename = `inlineScript${inlineCounter}`
    if (script.src) {
      let path = new URL(script.src);
      filename = path.pathname.substr(path.pathname.lastIndexOf('/')+ 1);
    } else {
      inlineCounter += 1;
    }

    return data[filename] = {
      name: filename,
      deferred: script.hasAttribute('defer'),
      async: script.hasAttribute('asynnc'),
      url: path ? path.href : 'inline',

    }
  });

  return data;
}

function getNextData() {
  const before = performance.measure('Next.js-before-hydration');
  const hydration = performance.measure('Next.js-hydration');
  const render = performance.measure('Next.js-render');

  return {
    beforeHydrationMS: before ? before.duration : null,
    hydrationMS: hydration ? hydration.duration : null,
    renderMS: render ? render.duration : null
  }  
}

// Loops through all CLS events (there can be dozens) to filter out minor ones
// and then pulls out helpful debugging info for all shifts to pass to Honeycomb
function extractLargeShifts(entries) {
  let shifts = {};
  let i = 0;

  entries.forEach((shift) => {
    // Adjust the CLS Threshold for to include more events
    if (shift.value >= CLS_THRESHOLD) {
      
      const resp = shifts[`shift_${i+=1}`] = {
        value: shift.value,
      }

      let classLists = [];
      let parents = [];

      // 'source' is the CWV identified culprit for a layout shift
      shift.sources.forEach((source) => { 
        // This grabs all classes on the source element, to help identify the where on page it is
        classLists.concat([...source.node.classList]);
        // This grabs the classes on the source element's parent element
        parents.concat([...source.node.parentElement.classList]);
        // Initial height and width of the element that triggered a layout shift
        resp.initialHeight = source.previousRect.height;
        resp.initialWidth = source.previousRect.width;
        // End height and width of the element. This gives us the pixel value of layout shift size.
        resp.endHeight = source.currentRect.height;
        resp.endWidth = source.currentRect.width;
      });

      resp.sourceElementClassLists = classLists;
      resp.sourceElementParentClassList = parents;
    }
  });

  return shifts;
}

// handler for Cumulative Layout Shift
function handleCLSEvent(evt) {
  let report = {
    name: evt.name,
    cls_delta: evt.delta,
    cls_value: evt.value,
    ...extractLargeShifts(evt.entries),
    ...metadata
  };

  send(report);
}

// Handler for Largest Contentful Paint
function reportLCP(metric) {
  const report = {
    name: metric.name,
    lcp_value: metric.value,
    lcp_delta: metric.delta,
    ...metadata
  };

  if (metric.entries.length > 0 ) {
    // It's possible we need to loop through all entries
    let lcp = metric.entries[0];
    // Computed pixel size of the largest content
    report.size = lcp.size;
    // Time it took (from page start load) to load the content
    report.duration = lcp.duration;
    // url if the largest content is media
    report.url = lcp.url;
  }

  send(report);
}

// Handler for First Input Delay
function reportScriptTiming(metric) {
  const loadTime = performance.measure('document execution time', 'docStart', 'docEnd');
  const report = {
    name: metric.name,
    fid_value: metric.value,
    fid_delta: metric.delta,
    documentLoadTimeMS: loadTime.duration,
    scriptsOnPage: document.scripts.length,
    scripts: captureScriptData(),
    ...getNextData(),
    ...metadata
  }
  send(report);
}

// Handler for Time to First Bite
function reportLoadTiming(metric) {
  const report = {
    name: metric.name,
    ttfb_value: metric.value,
    ttfb_delta: metric.delta,
    ...metadata
  }
  send(report);
}

async function send(metric) {
  console.log(metric);
  await axios.put(`${process.env.NEXT_PUBLIC_ENDPOINT}`, { metric })
}


export default function ({children}) {
  performance.mark('docEnd');
  captureMetadata();
  getCLS(handleCLSEvent);
  getFID(reportScriptTiming);
  getLCP(reportLCP);
  getTTFB(reportLoadTiming);
  return (
    <>
      {children}
    </>
  );
};