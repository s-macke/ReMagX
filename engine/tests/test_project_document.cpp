#include "remagx/project_document.hpp"
#include <cmath>
#include <cstring>
#include <iostream>
#include <limits>
#include <stdexcept>
#include <string>

using remagx::ProjectDocument;
static void require(bool condition, const char* message) {
    if (!condition) throw std::runtime_error(message);
}
template<class Action> static void rejected(Action action) {
    try { action(); } catch (const remagx::ProjectDocumentError&) { return; }
    throw std::runtime_error("Invalid document/edit was accepted");
}
static const std::string fixture = R"projectJSON({
 "format":"remagx-project","version":1,"name":"Native \u03b4 test",
 "sample":{"layers":[{"thickness":-0,"custom":"literal -0, quote: \" and slash: \\"}]},
 "experiment":{},"calculation":{},"fit":{},"scripts":{"default":"print(\"-0\")"},
 "datasets":[],"activeDatasetIndex":null,
 "future":{"a/b":0.12345678901234567,"integer":9007199254740993,"nested":[null,true,"\u0000"]}
})projectJSON";

int main(int argc, char** argv) {
    try {
        if (argc == 2 && std::string(argv[1]) == "--roundtrip") {
            const std::string input{std::istreambuf_iterator<char>(std::cin), std::istreambuf_iterator<char>()};
            std::cout << ProjectDocument::parse(input).serialize();
            return 0;
        }
        require(argc == 1, "Unknown test invocation");
        const auto original = ProjectDocument::parse(fixture);
        require(std::signbit(original.number("/sample/layers/0/thickness")), "Integer negative zero lost");
        require(original.number("/future/integer") == 9007199254740992.0, "Browser double conversion differs");
        const auto encoded = original.serialize();
        require(encoded.find("literal -0") != std::string::npos, "String token changed");
        require(encoded.find("print(\\\"-0\\\")") != std::string::npos, "Script changed");
        require(encoded.find("\\u0000") != std::string::npos, "Escaped NUL lost");
        const auto decoded = ProjectDocument::parse(encoded);
        require(decoded.serialize() == encoded, "Unknown fields/values failed round trip");
        require(decoded.number("/future/a~1b") == original.number("/future/a~1b"), "Escaped JSON pointer failed");
        for (double value : {0.0, -0.0, std::numeric_limits<double>::denorm_min(),
                             std::numeric_limits<double>::min(), std::numeric_limits<double>::max(),
                             -std::numeric_limits<double>::max(), std::nextafter(1.0, 2.0),
                             1e-200, 0.12345678901234567}) {
            const auto edited = original.with_number("/sample/layers/0/thickness", value);
            const double result = ProjectDocument::parse(edited.serialize()).number("/sample/layers/0/thickness");
            require(std::memcmp(&value, &result, sizeof(double)) == 0, "Double changed on serialization");
            require(original.serialize() == encoded, "Numeric edit mutated original");
            require(edited.number("/future/a~1b") == original.number("/future/a~1b"), "Unedited value changed");
        }
        for (const auto* path : {"/absent", "/sample/layers/1/thickness", "/name", "invalid-pointer"}) {
            rejected([&] { original.number(path); });
            rejected([&] { original.with_number(path, 1); });
        }
        for (double value : {std::numeric_limits<double>::infinity(),
                             std::numeric_limits<double>::quiet_NaN()})
            rejected([&] { original.with_number("/sample/layers/0/thickness", value); });
        rejected([&] { original.with_number("/version", 2); });
        const auto active = ProjectDocument::parse(original.serialize().replace(
            original.serialize().find("\"activeDatasetIndex\": null"), 26, "\"activeDatasetIndex\": 0"));
        rejected([&] { active.with_number("/activeDatasetIndex", -1); });
        rejected([&] { active.with_number("/activeDatasetIndex", 1.5); });
        for (const std::string& text : {"{}", "[]", "NaN", "{\"version\":1,\"version\":2}",
                                       "{\"name\":1,\"na\\u006de\":2}", "{\"value\":1e400}"})
            rejected([&] { ProjectDocument::parse(text); });
        for (const auto* extra : {", \"name\":\"overwritten\"", ", \"na\\u006de\":\"overwritten\""}) {
            auto duplicate = fixture;
            duplicate.insert(duplicate.rfind('}'), extra);
            rejected([&] { ProjectDocument::parse(duplicate); });
        }
        rejected([&] { ProjectDocument::parse(fixture + " trailing"); });
        rejected([&] { ProjectDocument::parse(fixture + std::string(1, '\0')); });
        auto nested = fixture;
        nested.insert(nested.rfind('}'), ",\"deep\":" + std::string(300, '[') + "0" + std::string(300, ']'));
        rejected([&] { ProjectDocument::parse(nested); });
        require(original.serialize() == encoded, "Failure changed original document");
        std::cout << "Project JSON envelope, unknown fields, immutable edits and exact double round trips passed.\n";
        return 0;
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}
