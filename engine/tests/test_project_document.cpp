#include "remagx/project_document.hpp"
#include <cmath>
#include <cstring>
#include <fstream>
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
static std::string load_fixture() {
    std::ifstream file(REMAGX_PROJECT_FIXTURE_PATH);
    require(file.good(), "Missing project fixture");
    std::string result{std::istreambuf_iterator<char>(file), std::istreambuf_iterator<char>()};
    const auto thickness = result.find("\"thickness\": 0");
    require(thickness != std::string::npos, "Missing zero thickness fixture");
    result.replace(thickness, 14, "\"thickness\": -0");
    result.insert(result.rfind('}'), R"projectJSON(,
      "future":{"a/b":0.12345678901234567,"integer":9007199254740993,
      "text":"literal -0, quote: \" and slash: \\" ,"script":"print(\"-0\")",
      "nested":[null,true,"\u0000"]})projectJSON");
    return result;
}

int main(int argc, char** argv) {
    try {
        if (argc == 2 && std::string(argv[1]) == "--roundtrip") {
            const std::string input{std::istreambuf_iterator<char>(std::cin), std::istreambuf_iterator<char>()};
            std::cout << ProjectDocument::parse(input).serialize();
            return 0;
        }
        if (argc == 2 && std::string(argv[1]) == "--validate-lines") {
            std::string input;
            while (std::getline(std::cin, input)) {
                try { ProjectDocument::parse(input); std::cout << "1\n"; }
                catch (const remagx::ProjectDocumentError&) { std::cout << "0\n"; }
            }
            return 0;
        }
        const auto fixture = load_fixture();
        require(argc == 1, "Unknown test invocation");
        const auto original = ProjectDocument::parse(fixture);
        require(original.string("/format") == "remagx-project", "String query failed");
        require(original.array_size("/sample/layers") >= 2, "Array query failed");
        require(original.contains("/sample/layers/0"), "Existing field not found");
        require(!original.contains("/sample/layers/999"), "Missing field found");
        rejected([&] { original.contains("invalid-pointer"); });
        require(original.is_null("/activeDatasetIndex"), "Null query failed");
        require(!original.boolean("/sample/multilayer/enabled"), "Boolean query failed");
        rejected([&] { original.string("/version"); });
        rejected([&] { original.boolean("/version"); });
        rejected([&] { original.array_size("/version"); });
        rejected([&] { original.is_null("/absent"); });
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
            const auto edited = original.with_number("/sample/layers/0/beta", value);
            const double result = ProjectDocument::parse(edited.serialize()).number("/sample/layers/0/beta");
            require(std::memcmp(&value, &result, sizeof(double)) == 0, "Double changed on serialization");
            require(original.serialize() == encoded, "Numeric edit mutated original");
            require(edited.number("/future/a~1b") == original.number("/future/a~1b"), "Unedited value changed");
        }
        for (const auto* path : {"/absent", "/sample/layers/999/thickness", "/name", "invalid-pointer"}) {
            rejected([&] { original.number(path); });
            rejected([&] { original.with_number(path, 1); });
        }
        for (double value : {std::numeric_limits<double>::infinity(),
                             std::numeric_limits<double>::quiet_NaN()})
            rejected([&] { original.with_number("/sample/layers/0/beta", value); });
        rejected([&] { original.with_number("/version", 2); });
        rejected([&] { original.with_number("/sample/layers/0/thickness", -1); });
        rejected([&] { original.with_number("/experiment/energy", 0); });
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
        std::cout << "Project JSON schema, unknown fields, immutable edits and exact double round trips passed.\n";
        return 0;
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}
