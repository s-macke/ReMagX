#include "remagx/legacy_import.hpp"
#include "json.hpp"
#include <iostream>
using Json = nlohmann::json;
int main() {
    std::string line;
    while (std::getline(std::cin, line)) {
        try {
            const auto request = Json::parse(line);
            std::string bytes;
            for (const auto& byte : request.at("bytes")) bytes += static_cast<char>(byte.get<unsigned char>());
            const auto imported = remagx::import_legacy_project(bytes, request.at("name").get<std::string>());
            Json messages = Json::array(), ignored = Json::array();
            for (const auto& message : imported.messages) {
                Json entry{{"level", message.level}, {"text", message.text}};
                if (message.line) entry["line"] = *message.line;
                messages.push_back(entry);
            }
            for (const auto& entry : imported.ignored_keys)
                ignored.push_back({{"key", entry.key}, {"count", entry.count}, {"firstLine", entry.first_line}});
            std::cout << Json{{"ok", true}, {"project", Json::parse(imported.project.serialize())},
                {"messages", messages}, {"ignoredKeys", ignored}}.dump() << '\n';
        } catch (const std::exception&) { std::cout << "{\"ok\":false}\n"; }
    }
    return 0;
}
