"use client";

import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowRight,
  Plus,
  Trash2,
  PlayCircle,
  Save,
  Link,
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Variable,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useRequestStore } from "@/hooks/use-request-store";
import { toast } from "@/hooks/use-toast";

interface ChainStep {
  id: string;
  requestId: string;
  requestName: string;
  collectionId: string;
  extractVariables: Array<{
    sourcePath: string; // JSONPath pour extraire de la réponse
    targetVariable: string; // Nom de la variable à créer
  }>;
  waitForPrevious: boolean;
  enabled: boolean;
}

interface RequestChainProps {
  onExecute?: (chain: ChainStep[]) => Promise<void>;
}

export function RequestChainWorkflow({ onExecute }: RequestChainProps) {
  const { t } = useTranslation();
  const { collections, addVariableMapping, variableMappings } = useRequestStore();
  const [chain, setChain] = useState<ChainStep[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [executing, setExecuting] = useState(false);

  const allRequests = useMemo(() => {
    return collections.flatMap((col) =>
      col.requests.map((req) => ({
        ...req,
        collectionId: col.id,
        collectionName: col.name,
      })),
    );
  }, [collections]);

  const addStep = () => {
    const newStep: ChainStep = {
      id: `step-${Date.now()}`,
      requestId: "",
      requestName: "",
      collectionId: "",
      extractVariables: [],
      waitForPrevious: true,
      enabled: true,
    };
    setChain([...chain, newStep]);
    setExpanded(new Set([...expanded, newStep.id]));
  };

  const removeStep = (stepId: string) => {
    setChain(chain.filter((s) => s.id !== stepId));
    const newExpanded = new Set(expanded);
    newExpanded.delete(stepId);
    setExpanded(newExpanded);
  };

  const updateStep = (stepId: string, updates: Partial<ChainStep>) => {
    setChain(chain.map((s) => (s.id === stepId ? { ...s, ...updates } : s)));
  };

  const addExtraction = (stepId: string) => {
    setChain(
      chain.map((s) =>
        s.id === stepId
          ? {
              ...s,
              extractVariables: [
                ...s.extractVariables,
                { sourcePath: "$.data.id", targetVariable: "extracted_id" },
              ],
            }
          : s,
      ),
    );
  };

  const removeExtraction = (stepId: string, index: number) => {
    setChain(
      chain.map((s) =>
        s.id === stepId
          ? {
              ...s,
              extractVariables: s.extractVariables.filter((_, i) => i !== index),
            }
          : s,
      ),
    );
  };

  const updateExtraction = (
    stepId: string,
    index: number,
    field: "sourcePath" | "targetVariable",
    value: string,
  ) => {
    setChain(
      chain.map((s) =>
        s.id === stepId
          ? {
              ...s,
              extractVariables: s.extractVariables.map((ext, i) =>
                i === index ? { ...ext, [field]: value } : ext,
              ),
            }
          : s,
      ),
    );
  };

  const toggleExpanded = (stepId: string) => {
    const newExpanded = new Set(expanded);
    if (newExpanded.has(stepId)) {
      newExpanded.delete(stepId);
    } else {
      newExpanded.add(stepId);
    }
    setExpanded(newExpanded);
  };

  const saveChain = () => {
    // Créer les variable mappings depuis la chaîne
    chain.forEach((step) => {
      step.extractVariables.forEach((extraction) => {
        addVariableMapping({
          name: extraction.targetVariable,
          sourceRequestId: step.requestId,
          sourcePath: extraction.sourcePath,
          enabled: true,
        });
      });
    });

    toast({
      title: t("chain.saved"),
      description: t("chain.savedDesc", { count: chain.length }),
    });
  };

  const executeChain = async () => {
    if (chain.length === 0) {
      toast({
        title: t("chain.empty"),
        description: t("chain.emptyDesc"),
        variant: "destructive",
      });
      return;
    }

    setExecuting(true);
    try {
      if (onExecute) {
        await onExecute(chain);
      }
      toast({
        title: t("chain.executed"),
        description: t("chain.executedDesc", { count: chain.length }),
      });
    } catch (error) {
      toast({
        title: t("chain.executionFailed"),
        description: error instanceof Error ? error.message : t("chain.unknownError"),
        variant: "destructive",
      });
    } finally {
      setExecuting(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <CardTitle className="flex items-center gap-2">
                <Link className="size-5 text-primary" />
                Request Chain Workflow
              </CardTitle>
              <CardDescription>
                Chain requests together and extract variables from responses
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={saveChain} disabled={chain.length === 0}>
                <Save className="size-4 mr-2" />
                Save Mappings
              </Button>
              <Button
                variant="default"
                size="sm"
                onClick={executeChain}
                disabled={executing || chain.length === 0}
              >
                {executing ? (
                  <>
                    <PlayCircle className="size-4 mr-2 animate-spin" />
                    Executing...
                  </>
                ) : (
                  <>
                    <PlayCircle className="size-4 mr-2" />
                    Execute Chain
                  </>
                )}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {chain.length === 0 ? (
            <div className="text-center py-12 border-2 border-dashed border-border rounded-lg">
              <Link className="size-12 mx-auto text-muted-foreground mb-4" />
              <p className="text-sm text-muted-foreground mb-4">
                No steps in chain. Add your first request.
              </p>
              <Button onClick={addStep}>
                <Plus className="size-4 mr-2" />
                Add First Step
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {chain.map((step, index) => {
                const isExpanded = expanded.has(step.id);
                const selectedRequest = allRequests.find((r) => r.id === step.requestId);

                return (
                  <div key={step.id} className="relative">
                    {index > 0 && <div className="absolute -top-3 left-6 h-3 w-0.5 bg-border" />}
                    <Card
                      className={cn(
                        "border-l-4",
                        step.enabled ? "border-l-primary" : "border-l-muted",
                      )}
                    >
                      <CardHeader className="pb-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3 flex-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="size-8 p-0"
                              onClick={() => toggleExpanded(step.id)}
                            >
                              {isExpanded ? (
                                <ChevronDown className="size-4" />
                              ) : (
                                <ChevronRight className="size-4" />
                              )}
                            </Button>
                            <Badge variant="outline" className="font-mono">
                              Step {index + 1}
                            </Badge>
                            <div className="flex-1">
                              <Select
                                value={step.requestId}
                                onValueChange={(requestId) => {
                                  const req = allRequests.find((r) => r.id === requestId);
                                  updateStep(step.id, {
                                    requestId,
                                    requestName: req?.name || "",
                                    collectionId: req?.collectionId || "",
                                  });
                                }}
                              >
                                <SelectTrigger className="w-full">
                                  <SelectValue placeholder="Select request..." />
                                </SelectTrigger>
                                <SelectContent>
                                  {collections.map((col) => (
                                    <div key={col.id}>
                                      <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
                                        {col.name}
                                      </div>
                                      {col.requests.map((req) => (
                                        <SelectItem key={req.id} value={req.id}>
                                          <span className="font-medium">{req.method}</span>{" "}
                                          {req.name || req.endpoint}
                                        </SelectItem>
                                      ))}
                                    </div>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <Button variant="ghost" size="sm" onClick={() => removeStep(step.id)}>
                              <Trash2 className="size-4 text-destructive" />
                            </Button>
                          </div>
                        </div>
                      </CardHeader>
                      {isExpanded && (
                        <CardContent className="pt-0 space-y-4">
                          {selectedRequest && (
                            <div className="flex items-center gap-2 text-xs text-muted-foreground p-2 bg-muted/50 rounded">
                              <CheckCircle2 className="size-3" />
                              {selectedRequest.method}{" "}
                              {selectedRequest.endpoint || selectedRequest.url}
                            </div>
                          )}

                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <Label className="text-xs font-semibold flex items-center gap-2">
                                <Variable className="size-3" />
                                Extract Variables
                              </Label>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => addExtraction(step.id)}
                              >
                                <Plus className="size-3 mr-1" />
                                Add Extraction
                              </Button>
                            </div>

                            {step.extractVariables.length === 0 ? (
                              <p className="text-xs text-muted-foreground p-2 border border-dashed rounded">
                                No extractions. Response won't be passed to next step.
                              </p>
                            ) : (
                              <div className="space-y-2">
                                {step.extractVariables.map((extraction, extIndex) => (
                                  <div
                                    key={extIndex}
                                    className="flex items-center gap-2 p-2 border rounded bg-background"
                                  >
                                    <div className="flex-1 space-y-1">
                                      <Input
                                        placeholder="$.data.id (JSONPath)"
                                        value={extraction.sourcePath}
                                        onChange={(e) =>
                                          updateExtraction(
                                            step.id,
                                            extIndex,
                                            "sourcePath",
                                            e.target.value,
                                          )
                                        }
                                        className="text-xs h-8"
                                      />
                                    </div>
                                    <ArrowRight className="size-4 text-muted-foreground shrink-0" />
                                    <div className="flex-1 space-y-1">
                                      <Input
                                        placeholder="variable_name"
                                        value={extraction.targetVariable}
                                        onChange={(e) =>
                                          updateExtraction(
                                            step.id,
                                            extIndex,
                                            "targetVariable",
                                            e.target.value,
                                          )
                                        }
                                        className="text-xs h-8"
                                      />
                                    </div>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="size-8 p-0"
                                      onClick={() => removeExtraction(step.id, extIndex)}
                                    >
                                      <Trash2 className="size-3 text-destructive" />
                                    </Button>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>

                          {step.extractVariables.length > 0 && (
                            <div className="flex items-start gap-2 p-2 bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-900 rounded text-xs">
                              <AlertCircle className="size-3 text-blue-600 dark:text-blue-400 mt-0.5 shrink-0" />
                              <p className="text-blue-900 dark:text-blue-100">
                                Extracted variables will be available as{" "}
                                <code className="font-mono bg-blue-100 dark:bg-blue-900 px-1 rounded">
                                  {`{{${step.extractVariables[0]?.targetVariable || "variable_name"}}}`}
                                </code>{" "}
                                in subsequent requests
                              </p>
                            </div>
                          )}
                        </CardContent>
                      )}
                    </Card>
                  </div>
                );
              })}

              <Button variant="outline" onClick={addStep} className="w-full">
                <Plus className="size-4 mr-2" />
                Add Step
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {variableMappings.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Existing Variable Mappings</CardTitle>
            <CardDescription className="text-xs">
              {variableMappings.length} mappings configured
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-1">
              {variableMappings.slice(0, 5).map((mapping) => (
                <div
                  key={mapping.id}
                  className="text-xs p-2 border rounded bg-muted/30 flex items-center gap-2"
                >
                  <code className="font-mono text-muted-foreground">{mapping.sourcePath}</code>
                  <ArrowRight className="size-3 text-muted-foreground" />
                  <code className="font-mono font-semibold">{`{{${mapping.name}}}`}</code>
                </div>
              ))}
              {variableMappings.length > 5 && (
                <p className="text-xs text-muted-foreground text-center pt-2">
                  +{variableMappings.length - 5} more
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
