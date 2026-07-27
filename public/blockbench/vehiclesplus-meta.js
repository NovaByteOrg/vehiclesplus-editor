/**
 * VehiclesPlus Metadata — BlockBench plugin.
 *
 * VehiclesPlus V4 vehicles ARE .bbmodel files carrying a custom top-level `vehiclesplus` block
 * (the vehicle definition: parts/transforms/seats/physics/sounds). Vanilla BlockBench strips
 * unknown top-level keys when saving a project, silently destroying the vehicle metadata.
 * This plugin keeps that block intact across open -> edit -> save.
 *
 * Install: BlockBench > File > Plugins > Load Plugin from File > pick this file.
 * (Or host it and use "Load Plugin from URL".)
 */
(function () {
  let parsedHandler;
  let compileHandler;

  Plugin.register("vehiclesplus_meta", {
    title: "VehiclesPlus Metadata",
    author: "NovaByte",
    description:
      "Keeps the custom 'vehiclesplus' vehicle metadata in .bbmodel files intact across open/save.",
    icon: "directions_car",
    version: "1.0.0",
    variant: "both",
    onload() {
      // On open: stash the metadata block on the (per-file) Project object.
      parsedHandler = ({ model }) => {
        if (model && model.vehiclesplus && typeof Project === "object" && Project) {
          Project.vehiclesplus_meta = model.vehiclesplus;
        }
      };
      // On save: put it back into the compiled model before it is stringified.
      compileHandler = ({ model }) => {
        if (model && typeof Project === "object" && Project && Project.vehiclesplus_meta) {
          model.vehiclesplus = Project.vehiclesplus_meta;
        }
      };
      Codecs.project.on("parsed", parsedHandler);
      Codecs.project.on("compile", compileHandler);
    },
    onunload() {
      if (parsedHandler) Codecs.project.removeListener("parsed", parsedHandler);
      if (compileHandler) Codecs.project.removeListener("compile", compileHandler);
    },
  });
})();
