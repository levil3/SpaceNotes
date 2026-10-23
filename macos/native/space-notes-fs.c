#include <errno.h>
#include <fcntl.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/stdio.h>
#include <unistd.h>

#ifndef O_CLOEXEC
#define O_CLOEXEC 0
#endif

#define PATH_BUFFER 4096

static int fail(const char *message) {
  fprintf(stderr, "%s: %s\n", message, strerror(errno));
  return 2;
}

static int invalid_path(const char *message) {
  fprintf(stderr, "%s\n", message);
  return 2;
}

static int open_root(const char *root) {
  return open(root, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
}

static int split_parent(
    int root_fd,
    const char *relative,
    char *base,
    size_t base_size
) {
  size_t length = strlen(relative);
  if (
      length == 0 ||
      length >= PATH_BUFFER ||
      relative[0] == '/'
  ) {
    return invalid_path("invalid relative path");
  }

  char buffer[PATH_BUFFER];
  memcpy(buffer, relative, length + 1);
  int current_fd = root_fd;
  char *cursor = buffer;
  char *component = NULL;
  while ((component = strsep(&cursor, "/")) != NULL) {
    if (component[0] == '\0' || strcmp(component, ".") == 0) {
      close(current_fd);
      return invalid_path("invalid relative path component");
    }
    if (strcmp(component, "..") == 0) {
      close(current_fd);
      return invalid_path("parent traversal is not allowed");
    }
    if (cursor == NULL) {
      if (strlen(component) >= base_size) {
        close(current_fd);
        return invalid_path("file name is too long");
      }
      strcpy(base, component);
      return current_fd;
    }

    int next_fd = openat(
        current_fd,
        component,
        O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC
    );
    close(current_fd);
    if (next_fd < 0) {
      return -1;
    }
    current_fd = next_fd;
  }

  close(current_fd);
  return invalid_path("relative path has no file name");
}

static int read_all_stdin(unsigned char **output, size_t *output_size) {
  size_t capacity = 8192;
  size_t length = 0;
  unsigned char *buffer = malloc(capacity);
  if (buffer == NULL) {
    return -1;
  }

  for (;;) {
    if (length == capacity) {
      size_t next_capacity = capacity * 2;
      unsigned char *next = realloc(buffer, next_capacity);
      if (next == NULL) {
        free(buffer);
        return -1;
      }
      buffer = next;
      capacity = next_capacity;
    }
    ssize_t count = read(STDIN_FILENO, buffer + length, capacity - length);
    if (count < 0) {
      if (errno == EINTR) {
        continue;
      }
      free(buffer);
      return -1;
    }
    if (count == 0) {
      break;
    }
    length += (size_t)count;
  }

  *output = buffer;
  *output_size = length;
  return 0;
}

static int write_all(int fd, const unsigned char *buffer, size_t length) {
  size_t offset = 0;
  while (offset < length) {
    ssize_t count = write(fd, buffer + offset, length - offset);
    if (count < 0) {
      if (errno == EINTR) {
        continue;
      }
      return -1;
    }
    offset += (size_t)count;
  }
  return 0;
}

static int copy_fd_to_stdout(int fd) {
  unsigned char buffer[16384];
  for (;;) {
    ssize_t count = read(fd, buffer, sizeof(buffer));
    if (count < 0) {
      if (errno == EINTR) {
        continue;
      }
      return -1;
    }
    if (count == 0) {
      return 0;
    }
    if (write_all(STDOUT_FILENO, buffer, (size_t)count) < 0) {
      return -1;
    }
  }
}

static int print_stat_json(const struct stat *status) {
  long long mtime_ms = 0;
#if defined(__APPLE__)
  mtime_ms =
      (long long)status->st_mtimespec.tv_sec * 1000LL +
      status->st_mtimespec.tv_nsec / 1000000LL;
#else
  mtime_ms =
      (long long)status->st_mtim.tv_sec * 1000LL +
      status->st_mtim.tv_nsec / 1000000LL;
#endif
  return printf(
      "{\"dev\":%llu,\"ino\":%llu,\"size\":%lld,\"mtimeMs\":%lld}\n",
      (unsigned long long)status->st_dev,
      (unsigned long long)status->st_ino,
      (long long)status->st_size,
      mtime_ms
  ) < 0 ? -1 : 0;
}

static int command_read(const char *root, const char *relative) {
  char base[PATH_BUFFER];
  int root_fd = open_root(root);
  if (root_fd < 0) {
    return fail("cannot open vault root");
  }
  int parent_fd = split_parent(root_fd, relative, base, sizeof(base));
  if (parent_fd < 0) {
    return fail("cannot open parent directory");
  }
  int file_fd = openat(
      parent_fd,
      base,
      O_RDONLY | O_NOFOLLOW | O_CLOEXEC
  );
  close(parent_fd);
  if (file_fd < 0) {
    return fail("cannot open file");
  }
  struct stat status;
  if (fstat(file_fd, &status) != 0 || !S_ISREG(status.st_mode)) {
    close(file_fd);
    return fail("entry is not a regular file");
  }
  if (copy_fd_to_stdout(file_fd) != 0) {
    close(file_fd);
    return fail("cannot read file");
  }
  close(file_fd);
  return 0;
}

static int command_stat(const char *root, const char *relative) {
  char base[PATH_BUFFER];
  int root_fd = open_root(root);
  if (root_fd < 0) {
    return fail("cannot open vault root");
  }
  int parent_fd = split_parent(root_fd, relative, base, sizeof(base));
  if (parent_fd < 0) {
    return fail("cannot open parent directory");
  }
  int file_fd = openat(
      parent_fd,
      base,
      O_RDONLY | O_NOFOLLOW | O_CLOEXEC
  );
  close(parent_fd);
  if (file_fd < 0) {
    return fail("cannot open file");
  }
  struct stat status;
  if (fstat(file_fd, &status) != 0 || !S_ISREG(status.st_mode)) {
    close(file_fd);
    return fail("entry is not a regular file");
  }
  int result = print_stat_json(&status);
  close(file_fd);
  return result == 0 ? 0 : fail("cannot write result");
}

static int command_write(
    const char *root,
    const char *relative,
    const char *mode
) {
  unsigned char *content = NULL;
  size_t content_size = 0;
  if (read_all_stdin(&content, &content_size) != 0) {
    return fail("cannot read stdin");
  }

  char base[PATH_BUFFER];
  int root_fd = open_root(root);
  if (root_fd < 0) {
    free(content);
    return fail("cannot open vault root");
  }
  int parent_fd = split_parent(root_fd, relative, base, sizeof(base));
  if (parent_fd < 0) {
    free(content);
    return fail("cannot open parent directory");
  }

  int exclusive = strcmp(mode, "exclusive") == 0;
  if (!exclusive && strcmp(mode, "existing") != 0) {
    close(parent_fd);
    free(content);
    return invalid_path("invalid write mode");
  }
  int file_fd;
  if (exclusive) {
    file_fd = openat(
        parent_fd,
        base,
        O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC,
        0666
    );
  } else {
    file_fd = openat(
        parent_fd,
        base,
        O_WRONLY | O_NOFOLLOW | O_CLOEXEC
    );
    if (file_fd < 0 && errno == ENOENT) {
      file_fd = openat(
          parent_fd,
          base,
          O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC,
          0666
      );
    }
  }
  close(parent_fd);
  if (file_fd < 0) {
    free(content);
    return fail("cannot open destination file");
  }

  struct stat status;
  if (fstat(file_fd, &status) != 0 || !S_ISREG(status.st_mode)) {
    close(file_fd);
    free(content);
    return invalid_path("destination is not a regular file");
  }
  if (
      ftruncate(file_fd, 0) != 0 ||
      write_all(file_fd, content, content_size) != 0 ||
      fsync(file_fd) != 0
  ) {
    close(file_fd);
    free(content);
    return fail("cannot write destination file");
  }
  free(content);
  if (fstat(file_fd, &status) != 0) {
    close(file_fd);
    return fail("cannot stat destination file");
  }
  int result = print_stat_json(&status);
  close(file_fd);
  return result == 0 ? 0 : fail("cannot write result");
}

static int command_rename(
    const char *root,
    const char *source_relative,
    const char *destination_relative
) {
  char source_base[PATH_BUFFER];
  char destination_base[PATH_BUFFER];
  int source_root_fd = open_root(root);
  int destination_root_fd = open_root(root);
  if (source_root_fd < 0 || destination_root_fd < 0) {
    if (source_root_fd >= 0) {
      close(source_root_fd);
    }
    if (destination_root_fd >= 0) {
      close(destination_root_fd);
    }
    return fail("cannot open vault root");
  }
  int source_parent = split_parent(
      source_root_fd,
      source_relative,
      source_base,
      sizeof(source_base)
  );
  if (source_parent < 0) {
    return fail("cannot open source parent directory");
  }
  int destination_parent = split_parent(
      destination_root_fd,
      destination_relative,
      destination_base,
      sizeof(destination_base)
  );
  if (destination_parent < 0) {
    close(source_parent);
    return fail("cannot open destination parent directory");
  }

  struct stat source_status;
  struct stat destination_status;
  if (
      fstatat(
          source_parent,
          source_base,
          &source_status,
          AT_SYMLINK_NOFOLLOW
      ) != 0
  ) {
    close(source_parent);
    close(destination_parent);
    return fail("cannot stat source entry");
  }
  if (
      fstatat(
          destination_parent,
          destination_base,
          &destination_status,
          AT_SYMLINK_NOFOLLOW
      ) == 0
  ) {
    if (
        source_status.st_dev == destination_status.st_dev &&
        source_status.st_ino == destination_status.st_ino
    ) {
      if (
          renameat(
              source_parent,
              source_base,
              destination_parent,
              destination_base
          ) == 0
      ) {
        close(source_parent);
        close(destination_parent);
        return 0;
      }
      close(source_parent);
      close(destination_parent);
      return fail("cannot rename entry");
    }
    close(source_parent);
    close(destination_parent);
    return fail("destination already exists");
  }
  if (errno != ENOENT) {
    close(source_parent);
    close(destination_parent);
    return fail("cannot inspect destination entry");
  }
  if (
      renameatx_np(
          source_parent,
          source_base,
          destination_parent,
          destination_base,
          RENAME_EXCL
      ) != 0
  ) {
    close(source_parent);
    close(destination_parent);
    return fail("cannot rename entry without replacing an existing path");
  }
  close(source_parent);
  close(destination_parent);
  return 0;
}

static int command_mkdir(const char *root, const char *relative) {
  size_t length = strlen(relative);
  if (
      length == 0 ||
      length >= PATH_BUFFER ||
      relative[0] == '/'
  ) {
    return invalid_path("invalid relative directory path");
  }

  int root_fd = open_root(root);
  if (root_fd < 0) {
    return fail("cannot open vault root");
  }

  char buffer[PATH_BUFFER];
  memcpy(buffer, relative, length + 1);
  int current_fd = root_fd;
  char *cursor = buffer;
  char *component = NULL;
  while ((component = strsep(&cursor, "/")) != NULL) {
    if (component[0] == '\0' || strcmp(component, "..") == 0) {
      close(current_fd);
      return invalid_path("invalid relative directory path component");
    }
    if (strcmp(component, ".") == 0) {
      continue;
    }

    int next_fd = openat(
        current_fd,
        component,
        O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC
    );
    if (next_fd < 0 && errno == ENOENT) {
      if (mkdirat(current_fd, component, 0777) != 0 && errno != EEXIST) {
        int saved_errno = errno;
        close(current_fd);
        errno = saved_errno;
        return fail("cannot create directory");
      }
      next_fd = openat(
          current_fd,
          component,
          O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC
      );
    }
    int saved_errno = errno;
    close(current_fd);
    if (next_fd < 0) {
      errno = saved_errno;
      return fail("cannot open directory");
    }
    current_fd = next_fd;
  }

  close(current_fd);
  return 0;
}

int main(int argc, char **argv) {
  if (argc < 3) {
    return invalid_path(
        "usage: space-notes-fs <read|stat|write|rename|mkdir> ..."
    );
  }
  if (strcmp(argv[1], "read") == 0 && argc == 4) {
    return command_read(argv[2], argv[3]);
  }
  if (strcmp(argv[1], "stat") == 0 && argc == 4) {
    return command_stat(argv[2], argv[3]);
  }
  if (strcmp(argv[1], "write") == 0 && argc == 5) {
    return command_write(argv[2], argv[3], argv[4]);
  }
  if (strcmp(argv[1], "rename") == 0 && argc == 5) {
    return command_rename(argv[2], argv[3], argv[4]);
  }
  if (strcmp(argv[1], "mkdir") == 0 && argc == 4) {
    return command_mkdir(argv[2], argv[3]);
  }
  return invalid_path("invalid command");
}
