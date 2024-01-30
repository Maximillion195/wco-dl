#!/bin/bash

# Check if the correct number of arguments is provided
if [ "$#" -ne 4 ]; then
    echo "Usage: $0 <directory_path> <file_permissions> <user> <group>"
    exit 1
fi

# Assign arguments to variables
directory_path=$1
file_permissions=$2
user=$3
group=$4

# Set permissions for the folder
chmod $file_permissions "$directory_path"

# Set permissions for all files within the folder
find "$directory_path" -type f -exec chmod $file_permissions {} \;
find "$directory_path" -exec chown "$user:$group" {} \;

echo "Permissions set to $file_permissions for $directory_path and its files."