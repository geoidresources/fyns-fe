import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ChevronRight, X } from "lucide-react";
import type { Measurement } from "@/lib/api/assetSvc";
import type { PanelMeasurement } from "@/lib/viewer/sampleData";

interface FeatureInspectorProps {
  measurement: Measurement | PanelMeasurement | null;
  onClose: () => void;
  onSave: (name: string) => void;
  isNew: boolean;
  saving: boolean;
}

export function FeatureInspector({
  measurement,
  onClose,
  onSave,
  isNew,
  saving,
}: FeatureInspectorProps) {
  const [name, setName] = React.useState(measurement?.name || "");
  const [prevId, setPrevId] = React.useState(measurement?.id);

  // Reset the editable name when a different feature is selected. Adjusting
  // state during render (instead of in an effect) avoids the cascading
  // re-render the effect caused — https://react.dev/learn/you-might-not-need-an-effect
  if (measurement?.id !== prevId) {
    setPrevId(measurement?.id);
    setName(measurement?.name || "");
  }

  if (!measurement) return null;

  const isVolume = measurement.kind === "volume";
  const title = isNew
    ? `Name this ${isVolume ? "polygon" : "polyline"}`
    : `Stockpile #${measurement.name}`;

  return (
    <div className="h-full flex flex-col text-sm text-gray-200 p-3 gap-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-base text-gray-100">{title}</h3>
        <Button variant="ghost" size="icon" onClick={onClose} className="text-gray-400">
          <X size={18} />
        </Button>
      </div>

      {isNew ? (
        <>
          <p className="text-xs text-gray-500 -mt-3">
            {isVolume
              ? "Saved as a volume measurement and computed against the survey DSM."
              : "Saved as a cross-section measurement."}
          </p>
          <Input
            autoFocus
            placeholder="e.g. Stockpile SP-12"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="bg-[#16181D] border-white/5"
          />
          <div className="flex gap-3 mt-auto">
            <Button onClick={() => onSave(name)} disabled={!name.trim() || saving} className="flex-1">
              {saving ? "Saving…" : "Save & compute"}
            </Button>
            <Button variant="secondary" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
          </div>
        </>
      ) : (
        <>
          <Tabs defaultValue="properties" className="flex flex-col flex-1">
            <TabsList className="bg-transparent p-0">
              <TabsTrigger value="properties">Properties</TabsTrigger>
              <TabsTrigger value="style">Style</TabsTrigger>
            </TabsList>
            <TabsContent value="properties" className="flex-1 flex flex-col gap-4 mt-2">
              <div className="flex gap-2">
                <span className="inline-flex items-center rounded-md bg-green-500/10 px-2 py-1 text-xs font-medium text-green-400 ring-1 ring-inset ring-green-500/20">
                  Approved
                </span>
                <span className="inline-flex items-center rounded-md bg-gray-400/10 px-2 py-1 text-xs font-medium text-gray-400 ring-1 ring-inset ring-gray-400/20">
                  Limestone
                </span>
              </div>
              <div className="bg-[#19191d] p-3 rounded-lg grid grid-cols-2 gap-3">
                <div><div className="text-gray-500 text-xs">Volume</div><div>12,840 m³</div></div>
                <div><div className="text-gray-500 text-xs">Tonnage</div><div>32,100 t</div></div>
                <div><div className="text-gray-500 text-xs">Area</div><div>1,420 m²</div></div>
                <div><div className="text-gray-500 text-xs">Perimeter</div><div>142 m</div></div>
              </div>
              <div className="text-gray-400 space-y-1">
                <p>Material: Limestone</p>
                <p>Density: 2.5 t/m³</p>
              </div>
              <div className="mt-auto flex flex-col gap-1">
                <Button variant="ghost" className="justify-between text-gray-300">Receipt <ChevronRight size={16}/></Button>
                <Button variant="destructive" className="w-full mt-4">Delete</Button>
              </div>
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}