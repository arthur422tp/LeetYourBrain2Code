import { describe, expect, it } from "vitest";
import { createListVisualizer } from "../../src/sidepanel/components/ListVisualizer";
import { createDictVisualizer } from "../../src/sidepanel/components/DictVisualizer";
import { createLinkedListVisualizer } from "../../src/sidepanel/components/LinkedListVisualizer";
import {
  createSelectionInspector,
  inspectionTarget
} from "../../src/sidepanel/components/SelectionInspector";
import type { DictVisualModel, ListVisualModel } from "../../src/core/visual-model";
import type { LinkedListVisualModel } from "../../src/core/linked-list-interpreter";
const int = (n: number) => ({type: "int" as const, value: String(n)});
const list: ListVisualModel = {kind:"list", visualId:"list:nums", variableName:"nums", items:[int(1),int(2)], pointers:[],changedIndexes:[]};
const dict: DictVisualModel = {kind:"dict",visualId:"dict:d",variableName:"d",entries:[{key:int(1),value:int(10),status:"unchanged"},{key:{type:"str",value:"1",length:1,truncated:false},value:int(20),status:"unchanged"}]};
const linked: LinkedListVisualModel = {kind:"linked_list",visualId:"linked_list:obj-1",nodes:[{objectId:"obj-1",className:"ListNode",label:int(1),nextObjectId:"obj-2",status:"unchanged",nextStatus:"unchanged"},{objectId:"obj-2",className:"ListNode",label:int(2),nextObjectId:null,status:"unchanged",nextStatus:"unchanged"}],components:[{componentId:"c",nodeIds:["obj-1","obj-2"],entryNodeIds:["obj-1"]}],pointers:[],cyclic:false,truncated:false};
const details = (element: HTMLElement) => element.querySelector(".visualizer-inspector")!.textContent!;
function select(element: HTMLElement, index: number) {
  const button = element.querySelectorAll<HTMLButtonElement>("button[data-inspect-key]")[index];
  expect(button).toBeDefined();
  button!.click();
  expect(button!.getAttribute("aria-pressed")).toBe("true");
}
describe("selection details across visualizers", () => {
  it("selects an SVG inspect target with keyboard activation", () => {
    const section = document.createElement("section");
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const path = inspectionTarget(
      document.createElementNS("http://www.w3.org/2000/svg", "path"),
      "edge:a→b",
      "Inspect connection a to b"
    );
    svg.append(path);
    section.append(svg);
    const inspector = createSelectionInspector(section, (key) => ({
      title: key,
      fields: [["kind", "connection"]]
    }));

    path.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(path.getAttribute("aria-pressed")).toBe("true");
    expect(inspector.selectedKey()).toBe("edge:a→b");
    inspector.dispose();
  });

  it("uses a preferred fallback before DOM order and falls back when it disappears", () => {
    const section = document.createElement("section");
    const secondary = inspectionTarget(
      document.createElement("button"),
      "node:secondary",
      "Inspect secondary"
    );
    const main = inspectionTarget(
      document.createElement("button"),
      "node:main",
      "Inspect main"
    );
    section.append(secondary, main);
    const inspector = createSelectionInspector(
      section,
      (key) => ({ title: key, fields: [] }),
      { preferredFallbackKey: () => "node:main" }
    );

    expect(inspector.selectedKey()).toBe("node:main");
    main.remove();
    inspector.refresh();
    expect(inspector.selectedKey()).toBe("node:secondary");
    inspector.dispose();
  });

  it("retains a selected list index through mutation and rebuild, and clears stale details on empty", () => {
    const handle = createListVisualizer(list);
    select(handle.element,1);
    handle.update({...list,items:[int(1),int(42),int(3)],changedIndexes:[1]});
    expect(details(handle.element)).toContain("42");
    expect(details(handle.element)).toContain("changed");
    select(handle.element,2);
    handle.update({...list,items:[]});
    expect(details(handle.element)).toContain("No items");
    expect(details(handle.element)).not.toContain("42");
    handle.dispose();
  });
  it("inspects an out-of-bounds request without inventing a value", () => {
    const handle = createListVisualizer({...list,pointers:[{name:"i",index:5,outOfBounds:true}]});
    select(handle.element,2);
    expect(details(handle.element)).toContain("out of bounds");
    expect(details(handle.element)).toContain("i = 5");
    handle.dispose();
  });
  it("follows the typed dictionary key through reorder and updates lookup information", () => {
    const handle = createDictVisualizer(dict);
    select(handle.element,1);
    handle.update({...dict,entries:[{...dict.entries[1]!,value:int(99)},dict.entries[0]!], probes:[{keyVariable:"key",key:{type:"str",value:"1",length:1,truncated:false},status:"hit",operation:"membership"}]});
    expect(details(handle.element)).toContain("99");
    expect(details(handle.element)).toContain("hit");
    expect(handle.element.querySelector('button[aria-pressed="true"]')?.textContent).toContain('"1"');
    handle.update({...dict,entries:[]});
    expect(details(handle.element)).toContain("No items");
    handle.dispose();
  });
  it("makes a missing dictionary lookup inspectable even when there is no entry", () => {
    const handle = createDictVisualizer({...dict,entries:[],probes:[{keyVariable:"target",key:int(9),status:"miss",operation:"subscript"}]});
    select(handle.element,0);
    expect(details(handle.element)).toContain("miss");
    expect(details(handle.element)).toContain("subscript");
    expect(details(handle.element)).toContain("9");
    handle.dispose();
  });
  it("follows linked node identity through reorder and refreshes next and aliases", () => {
    const handle = createLinkedListVisualizer(linked);
    select(handle.element,1);
    handle.update({...linked,nodes:[{...linked.nodes[1]!,label:int(33),nextObjectId:"obj-1",nextStatus:"changed"},linked.nodes[0]!],pointers:[{variableName:"curr",objectId:"obj-2",status:"moved"}]});
    expect(details(handle.element)).toContain("obj-2");
    expect(details(handle.element)).toContain("33");
    expect(details(handle.element)).toContain("obj-1");
    expect(details(handle.element)).toContain("curr");
    expect(details(handle.element)).toContain("changed");
    handle.update({...linked,nodes:[],components:[]});
    expect(details(handle.element)).toContain("No items");
    handle.dispose();
  });
});
