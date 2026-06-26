import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import {
  AreaChart,
  Circle,
  Minus,
  MousePointer,
  Pentagon,
  Scissors,
  X,
} from "lucide-react";

interface MeasurePaletteProps {
  onClose: () => void;
}

const tools = [
  { icon: MousePointer, label: "Point" },
  { icon: Minus, label: "Line" },
  { icon: Pentagon, label: "Polygon" },
  { icon: Scissors, label: "Section" },
  { icon: Circle, label: "Probe" },
  { icon: AreaChart, label: "Slope" },
];

export function MeasurePalette({ onClose }: MeasurePaletteProps) {
  return (
    <div className="h-full flex flex-col text-sm text-gray-200 p-3 gap-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-base text-gray-100">Measure</h3>
        <Button variant="ghost" size="icon" onClick={onClose} className="text-gray-400">
          <X size={18} />
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {tools.map((tool) => (
          <div
            key={tool.label}
            className="bg-[#19191d] border border-white/[0.08] rounded-md p-3 flex flex-col items-center justify-center gap-2 cursor-pointer hover:bg-white/5 transition-colors"
          >
            <tool.icon size={20} className="text-gray-400" />
            <span className="text-xs text-gray-300">{tool.label}</span>
          </div>
        ))}
      </div>

      <Card className="bg-[#19191d] border-white/[0.08]">
        <CardHeader className="p-3">
          <CardTitle className="text-xs font-medium text-gray-400">Live readout</CardTitle>
        </CardHeader>
        <CardContent className="p-3 pt-0 text-gray-200">
          <p>Volume: — m³</p>
          <p>Area: — m²</p>
        </CardContent>
      </Card>

      <div>
        <Label className="text-xs text-gray-400 mb-2 block">Volume method</Label>
        <RadioGroup defaultValue="smart-base" className="gap-1">
          {[
            { id: "smart-base", label: "Smart base" },
            { id: "reference-rl", label: "Reference RL" },
            { id: "previous-survey", label: "Previous survey" },
            { id: "design-surface", label: "Design surface" },
            { id: "custom-base", label: "Custom base" },
          ].map((item) => (
            <div key={item.id} className="flex items-center space-x-2">
              <RadioGroupItem value={item.id} id={item.id} />
              <Label htmlFor={item.id} className="text-gray-300 font-normal">
                {item.label}
              </Label>
            </div>
          ))}
        </RadioGroup>
      </div>
    </div>
  );
}