#ifndef REMAGX_PROJECT_CALCULATION_HPP
#define REMAGX_PROJECT_CALCULATION_HPP
#include "project_document.hpp"
#include "optical_tables.hpp"
#include <vector>
namespace remagx {
struct ProjectCurve {
    std::vector<double> qz;
    std::vector<double> plus;
    std::vector<double> minus;
    std::vector<std::string> warnings;
};
// Native terminal coordinates (0..qzMax inclusive), distinct from the web grid.
// Current integration: manual/automatic compound constants, Nevot-Croce/adaptive
// roughness, three solvers,
// multilayer expansion, angular/monochromatic energy convolution and postprocessing
// (monochromatic Fourier only). Other preparation rejects explicitly.
// No input mutation and no partial curve on failure.
ProjectCurve calculate_terminal_qz(const ProjectDocument& project, bool dichroic,
                                   const std::vector<OpticalTable>& tables = {});
}
#endif
